-- Fix Row-Level Security for public discovery endpoints
-- Enable RLS on public tables and allow unauthenticated read access

-- ============================================================================
-- Organizations: Public read access
-- ============================================================================
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizations_public_read ON organizations
    FOR SELECT USING (status = 'active');

-- ============================================================================
-- Branches: Public read access (for venue discovery)
-- ============================================================================
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY branches_public_read ON branches
    FOR SELECT USING (status = 'active');

-- ============================================================================
-- Courts: Public read access
-- ============================================================================
ALTER TABLE courts ENABLE ROW LEVEL SECURITY;
CREATE POLICY courts_public_read ON courts
    FOR SELECT USING (status = 'active');

-- ============================================================================
-- Rooms: Public read access
-- ============================================================================
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY rooms_public_read ON rooms
    FOR SELECT USING (status = 'active');

-- ============================================================================
-- Seats: Public read access
-- ============================================================================
ALTER TABLE seats ENABLE ROW LEVEL SECURITY;
CREATE POLICY seats_public_read ON seats
    FOR SELECT USING (status = 'active');

-- ============================================================================
-- Court Schedules: Public read access
-- ============================================================================
ALTER TABLE court_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY court_schedules_public_read ON court_schedules
    FOR SELECT USING (true);

-- ============================================================================
-- Room Schedules: Public read access
-- ============================================================================
ALTER TABLE room_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY room_schedules_public_read ON room_schedules
    FOR SELECT USING (true);

-- ============================================================================
-- Packages: Public read access
-- ============================================================================
ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY packages_public_read ON packages
    FOR SELECT USING (status = 'active');

-- ============================================================================
-- Notifications: Members and staff see their own notifications
-- ============================================================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_member_access ON notifications
    FOR SELECT USING (member_id = auth.uid() OR staff_id = auth.uid());

-- ============================================================================
-- Member Packages: Members see their own packages
-- ============================================================================
ALTER TABLE member_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY member_packages_member_access ON member_packages
    FOR SELECT USING (member_id = auth.uid());
