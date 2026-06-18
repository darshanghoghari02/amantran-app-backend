import express from 'express';
import { dbService } from '../services/db.js';
import { DEFAULT_ROLES, requirePermission, getUserPermissions, logAuditEvent } from '../middleware/auth.js';
import { hashPassword, verifyPassword } from '../utils/hash.js';

const router = express.Router();

// Helper to parse dates into ISO string safely
function getSafeDateString(val) {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (typeof val.toDate === 'function') return val.toDate().toISOString();
  if (typeof val.seconds === 'number') return new Date(val.seconds * 1000).toISOString();
  if (typeof val._seconds === 'number') return new Date(val._seconds * 1000).toISOString();
  if (val instanceof Date) return val.toISOString();
  try {
    const parsed = new Date(val);
    return isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  } catch (e) {
    return new Date().toISOString();
  }
}

// Helper to resolve dynamic permissions for a user list
async function resolveUsersPermissions(users) {
  if (!users || users.length === 0) return users;

  let roles = await dbService.getAll('roles');
  if (!roles || roles.length === 0) {
    roles = [];
    for (const r of DEFAULT_ROLES) {
      const seeded = await dbService.add('roles', r);
      roles.push(seeded);
    }
  }

  return users.map(user => {
    const userRole = user.roleId || user.role || 'user';
    const roleObj = roles.find(r => r.id === userRole);
    const safeCreatedAt = getSafeDateString(user.createdAt);

    // If the role is inactive, user gets no permissions
    if (roleObj && roleObj.isActive === false) {
      return {
        ...user,
        createdAt: safeCreatedAt,
        roleId: userRole,
        role: userRole,
        permissions: []
      };
    }

    const rolePermissions = roleObj ? (roleObj.permissions || []) : [];
    const customPermissions = user.customPermissions || user.permissions || [];

    // Combine role permissions and custom overrides (union)
    const combined = new Set([...rolePermissions, ...customPermissions]);

    return {
      ...user,
      createdAt: safeCreatedAt,
      roleId: userRole,
      role: userRole,
      customPermissions: customPermissions,
      permissions: Array.from(combined)
    };
  });
}

// Helper to resolve dynamic permissions for a single user
async function resolveUserPermissions(user) {
  if (!user) return user;
  const resolved = await resolveUsersPermissions([user]);
  return resolved[0];
}

// GET all users (with search and filter - guarded by users.view)
router.get('/', requirePermission('users.view'), async (req, res) => {
  try {
    const list = await dbService.getAll('users');
    const { query, role } = req.query;
    let filtered = [...list];

    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter(u =>
        (u.displayName && u.displayName.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q))
      );
    }

    if (role) {
      filtered = filtered.filter(u => u.role === role);
    }

    const resolved = await resolveUsersPermissions(filtered);

    // Sort by creation date safely (since createdAt is now guaranteed to be a string date)
    resolved.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json(resolved);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET all app_users (with search query - guarded by users.view)
router.get('/app-users', requirePermission('users.view'), async (req, res) => {
  try {
    const list = await dbService.getAll('app_users');
    const { query } = req.query;

    // Fetch ratings and user subscriptions to join them
    let ratings = [];
    let userSubscriptions = [];
    try {
      ratings = await dbService.getAll('ratings');
    } catch (err) {
      console.error('Error fetching ratings in user list:', err);
    }
    try {
      userSubscriptions = await dbService.getAll('user_subscriptions');
    } catch (err) {
      console.error('Error fetching user subscriptions in user list:', err);
    }

    // Normalize Firestore field names to a consistent frontend schema
    let normalized = list.map(u => {
      // Find user rating (latest first)
      const userRatings = ratings.filter(r => r.userId === u.id);
      userRatings.sort((a, b) => {
        const dateA = getSafeDateString(a.createdAt);
        const dateB = getSafeDateString(b.createdAt);
        return dateB.localeCompare(dateA);
      });
      const latestRating = userRatings[0] ? Number(userRatings[0].rating) : null;

      // Find active/existing subscription
      const userSub = userSubscriptions.find(s => s.userId === u.id || s.id === u.id);
      const subscription = userSub ? {
        id: userSub.id,
        userId: userSub.userId || userSub.id,
        planType: userSub.planType || userSub.type || 'monthly',
        type: userSub.planType || userSub.type || 'monthly',
        isActive: userSub.isActive !== false,
        startDate: userSub.startDate ? getSafeDateString(userSub.startDate) : null,
        expiryDate: userSub.expiryDate ? getSafeDateString(userSub.expiryDate) : null,
        amountPaid: Number(userSub.amountPaid) || 0,
        purchasedTemplates: userSub.purchasedTemplates || [],
        updatedAt: userSub.updatedAt ? getSafeDateString(userSub.updatedAt) : null
      } : null;

      return {
        id: u.id,
        displayName: u.displayName || u.name || 'Anonymous User',
        name: u.name || u.displayName || '',
        email: u.email || '',
        phone: u.phone || '',
        provider: u.provider || 'phone',
        profilePhoto: u.profilePhoto || '',
        accountStatus: u.accountStatus || 'active',
        // Normalize isBlocked: support both isBlocked field and accountStatus='suspended'
        isBlocked: u.isBlocked === true || u.accountStatus === 'suspended',
        invitationCount: u.invitationCount || 0,
        draftsCount: u.draftsCount || 0,
        createdAt: getSafeDateString(u.createdAt),
        lastLoginAt: u.lastLoginAt ? getSafeDateString(u.lastLoginAt) : null,
        rating: latestRating,
        subscription: subscription
      };
    });

    if (query) {
      const q = query.toLowerCase();
      normalized = normalized.filter(u =>
        (u.displayName && u.displayName.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.phone && u.phone.toLowerCase().includes(q)) ||
        (u.provider && u.provider.toLowerCase().includes(q))
      );
    }

    // Sort by creation date safely
    normalized.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    res.json(normalized);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update app_user details/block status (guarded by users.suspend / users.activate / users.edit)
router.put('/app-users/:id', async (req, res) => {
  try {
    const adminUserId = req.headers['x-user-id'];
    if (!adminUserId) {
      return res.status(401).json({ error: 'Missing x-user-id header.' });
    }

    // Resolve admin permissions
    const adminPerms = await getUserPermissions(adminUserId);
    const isSuperAdmin = adminPerms.includes('*');

    const { isBlocked, displayName, email, phone } = req.body;

    const userToEdit = await dbService.getOne('app_users', req.params.id);
    if (!userToEdit) {
      return res.status(404).json({ error: 'App user not found.' });
    }

    // Validate access permission dynamically
    let requiredPerm = 'users.edit';
    const isStatusChange = isBlocked !== undefined;

    if (isStatusChange) {
      requiredPerm = isBlocked ? 'users.suspend' : 'users.activate';
    }

    if (!isSuperAdmin && !adminPerms.includes(requiredPerm)) {
      return res.status(403).json({ error: `Forbidden. You do not have the required permission: ${requiredPerm}` });
    }

    const updates = {};
    if (isBlocked !== undefined) {
      updates.isBlocked = isBlocked;
      updates.status = isBlocked ? 'Suspended' : 'Active';
      updates.accountStatus = isBlocked ? 'suspended' : 'active';
    }
    if (displayName !== undefined) {
      updates.displayName = displayName;
      updates.name = displayName;
    }
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;

    const updated = await dbService.update('app_users', req.params.id, updates);

    // Write audit logs
    const nameStr = updated.displayName || updated.phone || updated.email || req.params.id;
    if (isStatusChange) {
      const actionStr = updated.isBlocked ? 'suspended' : 'activated';
      await logAuditEvent(adminUserId, `${actionStr.toUpperCase()} app user: ${nameStr}`, 'Users');
    } else {
      await logAuditEvent(adminUserId, `Updated app user details for: ${nameStr}`, 'Users');
    }

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE app_user (guarded by users.delete)
router.delete('/app-users/:id', requirePermission('users.delete'), async (req, res) => {
  try {
    const adminUserId = req.headers['x-user-id'];
    const userToDelete = await dbService.getOne('app_users', req.params.id);
    const nameStr = userToDelete ? (userToDelete.displayName || userToDelete.phone || userToDelete.email || 'Unknown') : req.params.id;

    await dbService.delete('app_users', req.params.id);
    await logAuditEvent(adminUserId, `Deleted app user: ${nameStr}`, 'Users');
    res.json({ success: true, message: 'App user deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single user (guarded by users.view or own profile check)
router.get('/:id', async (req, res) => {
  try {
    const adminUserId = req.headers['x-user-id'];
    if (!adminUserId) {
      return res.status(401).json({ error: 'Authentication required. Missing x-user-id header.' });
    }

    const isOwnProfile = adminUserId === req.params.id;

    if (!isOwnProfile) {
      const adminPerms = await getUserPermissions(adminUserId);
      if (!adminPerms.includes('*') && !adminPerms.includes('users.view')) {
        return res.status(403).json({ error: 'Forbidden. You do not have users.view permission.' });
      }
    }

    const user = await dbService.getOne('users', req.params.id);
    if (!user) {
      return res.status(404).json({ error: 'User profile not found' });
    }
    const resolved = await resolveUserPermissions(user);
    res.json(resolved);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create a new user (guarded by users.create)
router.post('/', requirePermission('users.create'), async (req, res) => {
  try {
    const { email, displayName, name, role, roleId, password, permissions, customPermissions, phoneNumber, status, isCustomPermissions } = req.body;
    const adminUserId = req.headers['x-user-id'];

    if (!email || (!displayName && !name) || (!role && !roleId)) {
      return res.status(400).json({ error: 'Email, name, and role are required fields.' });
    }

    const resolvedRole = roleId || role || 'user';
    const resolvedName = name || displayName;
    const resolvedCustomPermissions = customPermissions || permissions || [];
    const isSuspended = status === 'Suspended';

    const newUser = await dbService.add('users', {
      email,
      name: resolvedName,
      displayName: resolvedName,
      roleId: resolvedRole,
      role: resolvedRole,
      customPermissions: resolvedCustomPermissions,
      permissions: resolvedCustomPermissions,
      isCustomPermissions: isCustomPermissions === true,
      password: hashPassword(password || '123456'),
      phoneNumber: phoneNumber || '',
      status: status || 'Active',
      isBlocked: isSuspended,
      invitationCount: 0,
      draftsCount: 0,
      createdAt: new Date().toISOString()
    });

    const resolved = await resolveUserPermissions(newUser);
    await logAuditEvent(adminUserId, `Created user: ${resolved.name}`, 'Users');
    res.status(201).json(resolved);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required fields.' });
    }

    // 1. Support default developer credentials
    if (email.toLowerCase() === 'admin@amantran.com' && password === 'admin123') {
      return res.json({
        id: 'admin_super',
        email: 'admin@amantran.com',
        displayName: 'Super Admin',
        role: 'super_admin',
        isBlocked: false,
        invitationCount: 18,
        draftsCount: 6,
        createdAt: new Date().toISOString()
      });
    }

    // 2. Otherwise query database
    const users = await dbService.getAll('users');
    const matchedUser = users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());

    if (!matchedUser) {
      return res.status(400).json({ error: 'Incorrect email or password.' });
    }

    if (matchedUser.isBlocked) {
      return res.status(403).json({ error: 'Your account has been suspended.' });
    }

    const storedPassword = matchedUser.password || '123456';
    if (!verifyPassword(password, storedPassword)) {
      return res.status(400).json({ error: 'Incorrect email or password.' });
    }

    // Auto-migrate to hash if it was plain-text
    if (!storedPassword.startsWith('pbkdf2$')) {
      const newHash = hashPassword(password);
      matchedUser.password = newHash;
      await dbService.update('users', matchedUser.id, { password: newHash });
    }

    const resolved = await resolveUserPermissions(matchedUser);
    res.json(resolved);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update user details (dynamic action-level guards, audit logged)
router.put('/:id', async (req, res) => {
  try {
    const adminUserId = req.headers['x-user-id'];
    if (!adminUserId) {
      return res.status(401).json({ error: 'Missing x-user-id header.' });
    }

    // Resolve admin permissions
    const adminPerms = await getUserPermissions(adminUserId);
    const isSuperAdmin = adminPerms.includes('*');

    const { displayName, name, email, role, roleId, isBlocked, status, password, permissions, customPermissions, phoneNumber, isCustomPermissions } = req.body;

    const userToEdit = await dbService.getOne('users', req.params.id);
    if (!userToEdit) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Validate access permission dynamically
    let requiredPerm = 'users.edit';
    const isStatusChange = isBlocked !== undefined || status !== undefined;

    if (isStatusChange) {
      const targetSuspended = isBlocked === true || status === 'Suspended';
      requiredPerm = targetSuspended ? 'users.suspend' : 'users.activate';
    }

    if (!isSuperAdmin && !adminPerms.includes(requiredPerm)) {
      return res.status(403).json({ error: `Forbidden. You do not have the required permission: ${requiredPerm}` });
    }

    // Also guard role assignment or permission updates if the user doesn't have roles/permissions assignment rights
    const isRoleOrPermChange = role !== undefined || roleId !== undefined || permissions !== undefined || customPermissions !== undefined;
    if (isRoleOrPermChange && !isSuperAdmin) {
      if ((role !== undefined || roleId !== undefined) && !adminPerms.includes('users.assign_roles')) {
        return res.status(403).json({ error: 'Forbidden. You do not have permission to assign roles (users.assign_roles).' });
      }
      if ((permissions !== undefined || customPermissions !== undefined) && !adminPerms.includes('users.manage_permissions')) {
        return res.status(403).json({ error: 'Forbidden. You do not have permission to manage custom permissions overrides (users.manage_permissions).' });
      }
    }

    const updates = {};
    if (name !== undefined) {
      updates.name = name;
      updates.displayName = name;
    } else if (displayName !== undefined) {
      updates.name = displayName;
      updates.displayName = displayName;
    }

    if (email !== undefined) updates.email = email;

    if (roleId !== undefined) {
      updates.roleId = roleId;
      updates.role = roleId;
    } else if (role !== undefined) {
      updates.roleId = role;
      updates.role = role;
    }

    if (isBlocked !== undefined) {
      updates.isBlocked = isBlocked;
      updates.status = isBlocked ? 'Suspended' : 'Active';
    }
    if (status !== undefined) {
      updates.status = status;
      updates.isBlocked = status === 'Suspended';
    }

    if (password !== undefined) updates.password = hashPassword(password);
    if (phoneNumber !== undefined) updates.phoneNumber = phoneNumber;

    if (customPermissions !== undefined) {
      updates.customPermissions = Array.isArray(customPermissions) ? customPermissions : [];
      updates.permissions = Array.isArray(customPermissions) ? customPermissions : [];
    } else if (permissions !== undefined) {
      updates.customPermissions = Array.isArray(permissions) ? permissions : [];
      updates.permissions = Array.isArray(permissions) ? permissions : [];
    }

    if (isCustomPermissions !== undefined) {
      updates.isCustomPermissions = isCustomPermissions === true;
    }

    const updated = await dbService.update('users', req.params.id, updates);
    const resolved = await resolveUserPermissions(updated);

    // Write audit logs
    if (isStatusChange) {
      const actionStr = resolved.isBlocked ? 'suspended' : 'activated';
      await logAuditEvent(adminUserId, `${actionStr.toUpperCase()} user: ${resolved.name}`, 'Users');
    } else {
      await logAuditEvent(adminUserId, `Updated user details for: ${resolved.name}`, 'Users');
      if (roleId !== undefined && roleId !== userToEdit.roleId) {
        await logAuditEvent(adminUserId, `Assigned role ${resolved.roleId} to user: ${resolved.name}`, 'Users');
      }
    }

    res.json(resolved);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE user (guarded by users.delete)
router.delete('/:id', requirePermission('users.delete'), async (req, res) => {
  try {
    const adminUserId = req.headers['x-user-id'];
    const userToDelete = await dbService.getOne('users', req.params.id);
    const nameStr = userToDelete ? (userToDelete.name || userToDelete.displayName || 'Unknown') : req.params.id;

    await dbService.delete('users', req.params.id);
    await logAuditEvent(adminUserId, `Deleted user: ${nameStr}`, 'Users');
    res.json({ success: true, message: 'User deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
