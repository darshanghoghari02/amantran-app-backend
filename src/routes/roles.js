import express from 'express';
import { dbService } from '../services/db.js';
import { DEFAULT_ROLES, requirePermission, logAuditEvent } from '../middleware/auth.js';

const router = express.Router();

// GET all roles (seeds default roles if empty - guarded by roles.view)
router.get('/', requirePermission('roles.view'), async (req, res) => {
  try {
    let list = await dbService.getAll('roles');

    if (!list || list.length === 0) {
      console.log('🌱 No roles found in database. Seeding default roles...');
      list = [];
      for (const role of DEFAULT_ROLES) {
        const seeded = await dbService.add('roles', role);
        list.push(seeded);
      }
    }

    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET single role (guarded by roles.view)
router.get('/:id', requirePermission('roles.view'), async (req, res) => {
  try {
    const role = await dbService.getOne('roles', req.params.id);
    if (!role) {
      return res.status(404).json({ error: 'Role not found.' });
    }
    res.json(role);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST create custom role (guarded by roles.create)
router.post('/', requirePermission('roles.create'), async (req, res) => {
  try {
    const { name, description, isActive, cloneRoleId, permissions } = req.body;
    const userId = req.headers['x-user-id'];
    
    if (!name) {
      return res.status(400).json({ error: 'Role name is a required field.' });
    }

    let finalPermissions = Array.isArray(permissions) ? permissions : [];
    if (cloneRoleId) {
      const sourceRole = await dbService.getOne('roles', cloneRoleId);
      if (sourceRole) {
        finalPermissions = sourceRole.permissions || [];
      }
    }

    const id = 'role_' + Math.random().toString(36).substr(2, 9);
    const newRole = await dbService.add('roles', {
      id,
      name,
      description: description || '',
      permissions: finalPermissions,
      isDefault: false,
      isActive: isActive !== false
    });

    await logAuditEvent(userId, `Created role: ${newRole.name}`, 'Roles');
    res.status(201).json(newRole);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update role (guarded by roles.edit)
router.put('/:id', requirePermission('roles.edit'), async (req, res) => {
  try {
    const { name, description, permissions, isActive } = req.body;
    const userId = req.headers['x-user-id'];
    
    const role = await dbService.getOne('roles', req.params.id);
    if (!role) {
      return res.status(404).json({ error: 'Role not found.' });
    }

    // Protection for super_admin role properties
    if (role.id === 'super_admin') {
      return res.status(400).json({ error: 'Super Admin role permissions are read-only and system-protected.' });
    }

    const updates = {};
    if (permissions !== undefined) updates.permissions = Array.isArray(permissions) ? permissions : [];
    if (description !== undefined) updates.description = description;
    if (isActive !== undefined) updates.isActive = isActive === true;

    // Only allow updating name if it is a custom role
    if (!role.isDefault && name !== undefined) {
      updates.name = name;
    }

    const updated = await dbService.update('roles', req.params.id, updates);
    await logAuditEvent(userId, `Updated role settings for: ${role.name}`, 'Roles');
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE role (guarded by roles.delete)
router.delete('/:id', requirePermission('roles.delete'), async (req, res) => {
  try {
    const role = await dbService.getOne('roles', req.params.id);
    const userId = req.headers['x-user-id'];
    
    if (!role) {
      return res.status(404).json({ error: 'Role not found.' });
    }

    if (role.isDefault) {
      return res.status(400).json({ error: 'Default system roles cannot be deleted.' });
    }

    // Check if any user is currently assigned this custom role
    const users = await dbService.getAll('users');
    const assignedUsers = users.filter(u => (u.roleId === req.params.id || u.role === req.params.id));
    if (assignedUsers.length > 0) {
      return res.status(400).json({
        error: `Cannot delete role. It is currently assigned to ${assignedUsers.length} user(s) (e.g. ${assignedUsers[0].name || assignedUsers[0].displayName}).`
      });
    }

    await dbService.delete('roles', req.params.id);
    await logAuditEvent(userId, `Deleted role: ${role.name}`, 'Roles');
    res.json({ success: true, message: 'Role deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
