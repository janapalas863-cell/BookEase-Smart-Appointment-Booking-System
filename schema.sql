CREATE DATABASE IF NOT EXISTS bookease
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE bookease;

CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('customer', 'provider', 'admin') DEFAULT 'customer',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id INT PRIMARY KEY,
  phone VARCHAR(30),
  city VARCHAR(100),
  bio VARCHAR(1000),
  specialty VARCHAR(120),
  photo_url VARCHAR(2048),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_profiles_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS services (
  id INT PRIMARY KEY AUTO_INCREMENT,
  provider_id INT NOT NULL,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  price_min_inr DECIMAL(10,2),
  price_max_inr DECIMAL(10,2),
  duration_minutes INT NOT NULL DEFAULT 30,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_services_provider (provider_id),
  CONSTRAINT fk_services_provider
    FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_services_price CHECK (price >= 0),
  CONSTRAINT chk_services_inr_price_band CHECK (
    (price_min_inr IS NULL AND price_max_inr IS NULL) OR
    (price_min_inr IS NOT NULL AND price_max_inr IS NOT NULL AND
      price_min_inr >= 0 AND price_max_inr >= price_min_inr)
  ),
  CONSTRAINT chk_services_duration CHECK (duration_minutes > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS availability (
  id INT PRIMARY KEY AUTO_INCREMENT,
  provider_id INT NOT NULL,
  day_of_week ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday') NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  INDEX idx_availability_provider_day (provider_id, day_of_week),
  CONSTRAINT fk_availability_provider
    FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_availability_times CHECK (start_time < end_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS bookings (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id INT NOT NULL,
  service_id INT NOT NULL,
  booking_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_bookings_service_date_status (service_id, booking_date, status),
  INDEX idx_bookings_customer_date (customer_id, booking_date),
  CONSTRAINT fk_bookings_customer
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_bookings_service
    FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  CONSTRAINT chk_bookings_times CHECK (start_time < end_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reviews (
  id INT PRIMARY KEY AUTO_INCREMENT,
  booking_id INT NOT NULL UNIQUE,
  customer_id INT NOT NULL,
  provider_id INT NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment VARCHAR(1000),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reviews_provider_created (provider_id, created_at),
  CONSTRAINT fk_reviews_booking
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_customer
    FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_reviews_provider
    FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS offers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL,
  code VARCHAR(40) NOT NULL UNIQUE,
  reward_type ENUM('percent', 'fixed', 'points') NOT NULL,
  reward_value DECIMAL(10,2) NOT NULL,
  starts_at DATETIME,
  ends_at DATETIME,
  active BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

INSERT INTO offers (title, description, code, reward_type, reward_value)
SELECT 'A little welcome treat', 'Save 10% on your next salon visit.', 'WELCOME10', 'percent', 10
WHERE NOT EXISTS (SELECT 1 FROM offers WHERE code = 'WELCOME10');

INSERT INTO offers (title, description, code, reward_type, reward_value)
SELECT 'Loyalty bonus', 'Earn 10 points for every completed appointment.', 'STYLEPOINTS', 'points', 10
WHERE NOT EXISTS (SELECT 1 FROM offers WHERE code = 'STYLEPOINTS');
