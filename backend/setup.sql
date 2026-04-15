-- MySQL Setup for Barber Shop Backend
-- Run: mysql -u root -p < setup.sql (enter password: 54321)

-- 1. Create database
CREATE DATABASE IF NOT EXISTS `barber_shop`;
USE `barber_shop`;

-- 2. Slots table (9 daily slots, fixed times)
CREATE TABLE IF NOT EXISTS `slots` (
  `id` INT PRIMARY KEY,
  `time` VARCHAR(20) NOT NULL
);

-- Sample slots (9AM-6PM)
INSERT IGNORE INTO `slots` (`id`, `time`) VALUES
(1, '09:00 AM'), (2, '10:00 AM'), (3, '11:00 AM'),
(4, '12:00 PM'), (5, '01:00 PM'), (6, '02:00 PM'),
(7, '03:00 PM'), (8, '04:00 PM'), (9, '05:00 PM');

-- 3. Bookings table
CREATE TABLE IF NOT EXISTS `bookings` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `slot_id` INT NOT NULL,
  `booking_date` DATE NOT NULL,
  `customer_name` VARCHAR(100) NOT NULL,
  `haircut_style` VARCHAR(50) NOT NULL,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`slot_id`) REFERENCES `slots`(`id`)
);

-- 4. Sample data (today + tomorrow)
INSERT IGNORE INTO `bookings` (`slot_id`, `booking_date`, `customer_name`, `haircut_style`) VALUES
(2, CURDATE(), 'John Doe', 'Fade'),
(5, CURDATE(), 'Jane Smith', 'Taper'),
(8, CURDATE(), 'Bob Wilson', 'Buzz Cut'),
(1, DATE_ADD(CURDATE(), INTERVAL 1 DAY), 'Test User', 'Crew Cut');

SELECT '✅ Database ready! Run backend server.' AS status;
