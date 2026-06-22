// =============================================================================
// RBAC — single source of truth for roles and permissions.
//
// To add a role: add a key to ROLE_PERMISSIONS with its permission list.
// To add a permission: add the string to a role's list and guard the route with
// requirePermission('your:key'). The UI reads the resolved list from GET /me, so
// new permissions automatically flow to the front-end nav/actions.
//
// Enforcement is server-side (middleware + serializers). The UI only *hides*
// what the user can't do; it is never the security boundary.
// =============================================================================

const PERMISSIONS = {
  PRODUCTS_READ: 'products:read',
  PRODUCTS_WRITE: 'products:write',
  PRODUCTS_DELETE: 'products:delete',
  PRODUCTS_COST: 'products:cost', // may see/set cost price + profit
  STOREFRONT_TOGGLE: 'storefront:toggle', // "Show in store" on/off
  CATEGORIES_MANAGE: 'categories:manage', // add / edit / remove storefront categories
  BILLS_CREATE: 'bills:create',
  BILLS_READ: 'bills:read', // all bills
  BILLS_READ_OWN: 'bills:read:own', // only bills they created
  REPORTS_READ: 'reports:read',
  STAFF_MANAGE: 'staff:manage',
  PRINTERS_READ: 'printers:read', // read settings + print/reprint receipts
  PRINTERS_MANAGE: 'printers:manage', // edit printer settings
};

const ROLES = { OWNER: 'OWNER', STAFF: 'STAFF' };

const ROLE_PERMISSIONS = {
  // Owner: full access.
  OWNER: Object.values(PERMISSIONS),

  // Staff: make bills, scan, view OWN bill history, read products + print.
  // No cost price, no reports, no staff management, no printer config.
  STAFF: [
    PERMISSIONS.PRODUCTS_READ,
    PERMISSIONS.BILLS_CREATE,
    PERMISSIONS.BILLS_READ_OWN,
    PERMISSIONS.PRINTERS_READ,
  ],
};

function permissionsFor(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function hasPermission(role, permission) {
  return permissionsFor(role).includes(permission);
}

module.exports = { PERMISSIONS, ROLES, ROLE_PERMISSIONS, permissionsFor, hasPermission };
