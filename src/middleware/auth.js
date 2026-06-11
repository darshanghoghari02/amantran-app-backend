import { dbService } from '../services/db.js';

// Default seeded roles
export const DEFAULT_ROLES = [
  {
    id: 'super_admin',
    name: 'Super Admin',
    description: 'Super Administrator with absolute control over all features, settings, roles, and user accounts. System-protected.',
    permissions: ['*'],
    isDefault: true,
    isActive: true
  },
  {
    id: 'admin',
    name: 'Admin',
    description: 'Administrator who can manage content, subscriptions, and users, but cannot delete or modify Super Admin accounts.',
    permissions: [
      'dashboard.view',
      'templates.view', 'templates.create', 'templates.edit', 'templates.delete', 'templates.publish', 'templates.unpublish', 'templates.feature',
      'categories.view', 'categories.create', 'categories.edit', 'categories.delete',
      'fonts.view', 'fonts.create', 'fonts.edit', 'fonts.delete',
      'languages.view', 'languages.create', 'languages.edit', 'languages.delete',
      'subscriptions.view', 'subscriptions.create', 'subscriptions.edit', 'subscriptions.delete', 'subscriptions.activate', 'subscriptions.deactivate', 'subscriptions.manage_pricing',
      'users.view', 'users.create', 'users.edit', 'users.delete', 'users.suspend', 'users.activate', 'users.assign_roles', 'users.manage_permissions',
      'roles.view', 'roles.create', 'roles.edit', 'roles.delete', 'roles.clone', 'roles.assign_permissions',
      'analytics.view', 'analytics.export',
      'settings.view', 'settings.edit'
    ],
    isDefault: true,
    isActive: true
  },
  {
    id: 'content_manager',
    name: 'Content Manager',
    description: 'Can manage invitations, templates, categories, custom typography, and platform languages.',
    permissions: [
      'dashboard.view',
      'templates.view', 'templates.create', 'templates.edit', 'templates.delete', 'templates.publish', 'templates.unpublish', 'templates.feature',
      'categories.view', 'categories.create', 'categories.edit', 'categories.delete',
      'fonts.view', 'fonts.create', 'fonts.edit', 'fonts.delete',
      'languages.view', 'languages.create', 'languages.edit', 'languages.delete'
    ],
    isDefault: true,
    isActive: true
  },
  {
    id: 'subscription_manager',
    name: 'Subscription Manager',
    description: 'Can manage billing, subscription plans, pricing tiers, and deactivate payment integrations.',
    permissions: [
      'dashboard.view',
      'templates.view',
      'subscriptions.view', 'subscriptions.create', 'subscriptions.edit', 'subscriptions.delete', 'subscriptions.activate', 'subscriptions.deactivate', 'subscriptions.manage_pricing'
    ],
    isDefault: true,
    isActive: true
  },
  {
    id: 'editor',
    name: 'Editor',
    description: 'Can edit templates and view content catalogs but cannot delete records or adjust configurations.',
    permissions: [
      'dashboard.view',
      'templates.view', 'templates.edit',
      'categories.view',
      'fonts.view',
      'languages.view'
    ],
    isDefault: true,
    isActive: true
  },
  {
    id: 'user',
    name: 'Standard User',
    description: 'Read-only access to view stats and design catalog.',
    permissions: [
      'dashboard.view',
      'templates.view',
      'categories.view'
    ],
    isDefault: true,
    isActive: true
  }
];

// Helper to resolve user permissions (combining role permissions + custom overrides)
export async function getUserPermissions(userId) {
  if (userId === 'admin_super') {
    return ['*'];
  }

  const user = await dbService.getOne('users', userId);
  if (!user) return [];

  // Check if account is suspended/blocked
  if (user.isBlocked || user.status === 'Suspended') {
    return [];
  }

  const roleId = user.roleId || user.role || 'user';
  
  // Fetch role
  let role = await dbService.getOne('roles', roleId);
  
  // If role is not in the db, check if it's one of the defaults
  if (!role) {
    role = DEFAULT_ROLES.find(r => r.id === roleId);
  }

  // If role is inactive, the user gets no permissions
  if (role && role.isActive === false) {
    return [];
  }

  const rolePermissions = role ? (role.permissions || []) : [];
  
  // customPermissions overrides
  const customPermissions = user.customPermissions || user.permissions || [];
  
  // Combine role permissions and custom overrides (union)
  const combined = new Set([...rolePermissions, ...customPermissions]);
  
  return Array.from(combined);
}

// Middleware to check for a specific permission
export function requirePermission(requiredPerm) {
  return async (req, res, next) => {
    try {
      const userId = req.headers['x-user-id'];
      if (!userId) {
        return res.status(401).json({ error: 'Authentication required. Missing x-user-id header.' });
      }

      const permissions = await getUserPermissions(userId);
      
      // Super admin has '*' wildcard
      if (permissions.includes('*')) {
        return next();
      }

      if (permissions.includes(requiredPerm)) {
        return next();
      }

      return res.status(403).json({ error: `Forbidden. You do not have the required permission: ${requiredPerm}` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  };
}

// Helper to log audit events into Firestore
export async function logAuditEvent(userId, action, resource) {
  try {
    let name = 'Unknown User';
    if (userId === 'admin_super') {
      name = 'Super Admin';
    } else if (userId) {
      const user = await dbService.getOne('users', userId);
      if (user) {
        name = user.name || user.displayName || user.email;
      }
    }

    const logEntry = {
      user: name,
      userId: userId || 'unknown',
      action: action,
      resource: resource || 'general',
      date: new Date().toLocaleDateString('en-GB'), // DD/MM/YYYY
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      createdAt: new Date().toISOString()
    };

    await dbService.add('audit_logs', logEntry);
  } catch (error) {
    console.error('⚠️ Failed to log audit event:', error.message);
  }
}
