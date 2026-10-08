-- Booking Hub Seed Data
-- Sample data for testing and development

-- Organizations
INSERT INTO organizations (name, type, ntn_number, status) VALUES
('Sports Pro', 'Sports', '1234567890', 'active'),
('Gaming Hub', 'Gaming', '0987654321', 'active');

-- Branches
INSERT INTO branches (organization_id, name, venue_type, location, description, amenities, tax_enabled, tax_rate_percent, default_currency, status) VALUES
((SELECT id FROM organizations WHERE name = 'Sports Pro'), 'Downtown Tennis Courts', 'Court', '123 Main St', 'Premium tennis facility in downtown', ARRAY['lights', 'parking', 'cafe'], true, 17, 'PKR', 'active'),
((SELECT id FROM organizations WHERE name = 'Sports Pro'), 'Uptown Padel Zone', 'Court', '456 Oak Ave', 'Modern padel courts', ARRAY['ac', 'parking', 'lounge'], true, 17, 'PKR', 'active'),
((SELECT id FROM organizations WHERE name = 'Gaming Hub'), 'Downtown Gaming', 'Zone', '789 Gaming St', 'Premium CS2 and PS5 gaming zone', ARRAY['ac', 'high-speed-internet', 'gaming-pcs'], true, 17, 'PKR', 'active');

-- Courts (Tennis)
INSERT INTO courts (branch_id, name, sport_type, capacity, hourly_rate, amenities, status) VALUES
((SELECT id FROM branches WHERE name = 'Downtown Tennis Courts'), 'Court 1', 'tennis', 2, 5000, ARRAY['lights', 'net', 'bench'], 'active'),
((SELECT id FROM branches WHERE name = 'Downtown Tennis Courts'), 'Court 2', 'tennis', 2, 5000, ARRAY['lights', 'net', 'bench'], 'active'),
((SELECT id FROM branches WHERE name = 'Uptown Padel Zone'), 'Padel Court 1', 'padel', 4, 6000, ARRAY['lights', 'ac', 'glass-walls'], 'active'),
((SELECT id FROM branches WHERE name = 'Uptown Padel Zone'), 'Padel Court 2', 'padel', 4, 6000, ARRAY['lights', 'ac', 'glass-walls'], 'active');

-- Rooms (Gaming)
INSERT INTO rooms (branch_id, name, game_type, capacity, booking_mode, hourly_rate, amenities, status) VALUES
((SELECT id FROM branches WHERE name = 'Downtown Gaming'), 'CS2 Room A', 'cs2', 5, 'PerSeat', 3000, ARRAY['ac', 'gaming-pc', 'high-end-gpu'], 'active'),
((SELECT id FROM branches WHERE name = 'Downtown Gaming'), 'PS5 Room B', 'ps5', 4, 'WholeRoom', 2000, ARRAY['ps5-console', 'ac', 'big-screen'], 'active');

-- Seats (for gaming rooms with PerSeat booking)
INSERT INTO seats (room_id, label, hourly_rate, status) VALUES
((SELECT id FROM rooms WHERE name = 'CS2 Room A'), 'PC-01', 600, 'active'),
((SELECT id FROM rooms WHERE name = 'CS2 Room A'), 'PC-02', 600, 'active'),
((SELECT id FROM rooms WHERE name = 'CS2 Room A'), 'PC-03', 600, 'active'),
((SELECT id FROM rooms WHERE name = 'CS2 Room A'), 'PC-04', 600, 'active'),
((SELECT id FROM rooms WHERE name = 'CS2 Room A'), 'PC-05', 600, 'active');

-- Court Schedules (when courts are open)
INSERT INTO court_schedules (court_id, day_of_week, open_time, close_time, slot_minutes) VALUES
((SELECT id FROM courts WHERE name = 'Court 1'), 0, '09:00:00', '22:00:00', 60), -- Sunday
((SELECT id FROM courts WHERE name = 'Court 1'), 1, '09:00:00', '22:00:00', 60), -- Monday
((SELECT id FROM courts WHERE name = 'Court 1'), 2, '09:00:00', '22:00:00', 60), -- Tuesday
((SELECT id FROM courts WHERE name = 'Court 1'), 3, '09:00:00', '22:00:00', 60), -- Wednesday
((SELECT id FROM courts WHERE name = 'Court 1'), 4, '09:00:00', '22:00:00', 60), -- Thursday
((SELECT id FROM courts WHERE name = 'Court 1'), 5, '08:00:00', '23:00:00', 60), -- Friday
((SELECT id FROM courts WHERE name = 'Court 1'), 6, '08:00:00', '23:00:00', 60), -- Saturday
((SELECT id FROM courts WHERE name = 'Court 2'), 0, '09:00:00', '22:00:00', 60),
((SELECT id FROM courts WHERE name = 'Court 2'), 1, '09:00:00', '22:00:00', 60),
((SELECT id FROM courts WHERE name = 'Court 2'), 2, '09:00:00', '22:00:00', 60),
((SELECT id FROM courts WHERE name = 'Court 2'), 3, '09:00:00', '22:00:00', 60),
((SELECT id FROM courts WHERE name = 'Court 2'), 4, '09:00:00', '22:00:00', 60),
((SELECT id FROM courts WHERE name = 'Court 2'), 5, '08:00:00', '23:00:00', 60),
((SELECT id FROM courts WHERE name = 'Court 2'), 6, '08:00:00', '23:00:00', 60),
((SELECT id FROM courts WHERE name = 'Padel Court 1'), 0, '10:00:00', '22:00:00', 60),
((SELECT id FROM courts WHERE name = 'Padel Court 1'), 1, '10:00:00', '22:00:00', 60),
((SELECT id FROM courts WHERE name = 'Padel Court 1'), 2, '10:00:00', '22:00:00', 60),
((SELECT id FROM courts WHERE name = 'Padel Court 1'), 3, '10:00:00', '22:00:00', 60),
((SELECT id FROM courts WHERE name = 'Padel Court 1'), 4, '10:00:00', '22:00:00', 60),
((SELECT id FROM courts WHERE name = 'Padel Court 1'), 5, '09:00:00', '23:00:00', 60),
((SELECT id FROM courts WHERE name = 'Padel Court 1'), 6, '09:00:00', '23:00:00', 60);

-- Room Schedules (when rooms are open)
INSERT INTO room_schedules (room_id, day_of_week, open_time, close_time, slot_minutes) VALUES
((SELECT id FROM rooms WHERE name = 'CS2 Room A'), 0, '12:00:00', '23:00:00', 60),
((SELECT id FROM rooms WHERE name = 'CS2 Room A'), 1, '15:00:00', '23:00:00', 60),
((SELECT id FROM rooms WHERE name = 'CS2 Room A'), 2, '15:00:00', '23:00:00', 60),
((SELECT id FROM rooms WHERE name = 'CS2 Room A'), 3, '15:00:00', '23:00:00', 60),
((SELECT id FROM rooms WHERE name = 'CS2 Room A'), 4, '15:00:00', '23:00:00', 60),
((SELECT id FROM rooms WHERE name = 'CS2 Room A'), 5, '12:00:00', '23:00:00', 60),
((SELECT id FROM rooms WHERE name = 'CS2 Room A'), 6, '12:00:00', '23:00:00', 60),
((SELECT id FROM rooms WHERE name = 'PS5 Room B'), 0, '12:00:00', '23:00:00', 60),
((SELECT id FROM rooms WHERE name = 'PS5 Room B'), 1, '15:00:00', '23:00:00', 60),
((SELECT id FROM rooms WHERE name = 'PS5 Room B'), 2, '15:00:00', '23:00:00', 60),
((SELECT id FROM rooms WHERE name = 'PS5 Room B'), 3, '15:00:00', '23:00:00', 60),
((SELECT id FROM rooms WHERE name = 'PS5 Room B'), 4, '15:00:00', '23:00:00', 60),
((SELECT id FROM rooms WHERE name = 'PS5 Room B'), 5, '12:00:00', '23:00:00', 60),
((SELECT id FROM rooms WHERE name = 'PS5 Room B'), 6, '12:00:00', '23:00:00', 60);

-- Packages
INSERT INTO packages (branch_id, scope, scope_id, name, package_type, sessions_included, valid_days, price, status) VALUES
((SELECT id FROM branches WHERE name = 'Downtown Tennis Courts'), 'Court', NULL, '10 Tennis Sessions', 'FixedSessions', 10, 90, 45000, 'active'),
((SELECT id FROM branches WHERE name = 'Downtown Tennis Courts'), 'Court', NULL, 'Unlimited Monthly', 'UnlimitedMonthly', NULL, 30, 15000, 'active'),
((SELECT id FROM branches WHERE name = 'Downtown Tennis Courts'), 'Court', NULL, '50% Off Package', 'DiscountPercent', NULL, 30, 0, 'active'),
((SELECT id FROM branches WHERE name = 'Uptown Padel Zone'), 'Court', NULL, '5 Padel Sessions', 'FixedSessions', 5, 60, 30000, 'active'),
((SELECT id FROM branches WHERE name = 'Downtown Gaming'), 'Room', NULL, '20 Gaming Hours', 'BundleHours', NULL, 90, 12000, 'active'),
((SELECT id FROM branches WHERE name = 'Downtown Gaming'), 'Room', NULL, 'Unlimited Gaming', 'UnlimitedMonthly', NULL, 30, 8000, 'active');
