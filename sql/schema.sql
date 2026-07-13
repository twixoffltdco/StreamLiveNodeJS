-- StreamLive schema (MySQL 8+)
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(191) UNIQUE,
  username VARCHAR(64) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  avatar VARCHAR(500) DEFAULT NULL,
  role ENUM('user','moderator','admin') DEFAULT 'user',
  is_banned TINYINT(1) DEFAULT 0,
  oauth_provider VARCHAR(64) DEFAULT NULL,
  oauth_id VARCHAR(191) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Провайдеры соц. авторизации, настраиваются админом (клиент id/secret/иконка)
CREATE TABLE IF NOT EXISTS oauth_providers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) UNIQUE NOT NULL,       -- google | vk | yandex | ...
  display_name VARCHAR(100) NOT NULL,
  icon_url VARCHAR(500) DEFAULT NULL,
  client_id VARCHAR(255),
  client_secret VARCHAR(255),
  auth_url VARCHAR(500),
  token_url VARCHAR(500),
  profile_url VARCHAR(500),
  scope VARCHAR(255) DEFAULT '',
  enabled TINYINT(1) DEFAULT 0
);

-- Источники вещания, которые админ добавляет как "стандартные" варианты
CREATE TABLE IF NOT EXISTS sources (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  type ENUM('mp4','m3u8','youtube','vk','rutube','iframe') NOT NULL,
  url VARCHAR(1000) NOT NULL,
  created_by INT DEFAULT NULL,           -- NULL = добавлен админом (общий), иначе владелец канала
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS channels (
  id INT AUTO_INCREMENT PRIMARY KEY,
  owner_id INT NOT NULL,
  slug VARCHAR(150) UNIQUE NOT NULL,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  type ENUM('tv','radio') NOT NULL DEFAULT 'tv',
  logo_url VARCHAR(500),
  default_source_id INT DEFAULT NULL,     -- источник по умолчанию, если нет активного расписания
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  reject_reason VARCHAR(500) DEFAULT NULL,
  seo_title VARCHAR(200),
  seo_description VARCHAR(400),
  seo_keywords VARCHAR(400),
  views BIGINT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (default_source_id) REFERENCES sources(id) ON DELETE SET NULL
);

-- Еженедельное расписание эфира (пн-вс, диапазон времени -> источник)
CREATE TABLE IF NOT EXISTS schedule (
  id INT AUTO_INCREMENT PRIMARY KEY,
  channel_id INT NOT NULL,
  day_of_week TINYINT NOT NULL,          -- 0=Пн ... 6=Вс
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  source_id INT NOT NULL,
  program_title VARCHAR(150) DEFAULT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_moderators (
  id INT AUTO_INCREMENT PRIMARY KEY,
  channel_id INT NOT NULL,
  user_id INT NOT NULL,
  UNIQUE KEY uniq_mod (channel_id, user_id),
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_bans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  channel_id INT NOT NULL,
  user_id INT NOT NULL,
  UNIQUE KEY uniq_ban (channel_id, user_id),
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Кастомные стикеры канала (как на Twitch)
CREATE TABLE IF NOT EXISTS stickers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  channel_id INT NOT NULL,
  code VARCHAR(50) NOT NULL,             -- например :pepeHype:
  image_url VARCHAR(500) NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  channel_id INT NOT NULL,
  user_id INT NOT NULL,
  message TEXT NOT NULL,
  is_deleted TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  channel_id INT DEFAULT NULL,
  type VARCHAR(50) NOT NULL,             -- channel_rejected | channel_approved
  message VARCHAR(500) NOT NULL,
  is_read TINYINT(1) DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT COLLATE utf8mb4_bin
);
