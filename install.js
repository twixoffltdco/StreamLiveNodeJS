// node install.js — накатывает схему и создаёт первого администратора
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

(async () => {
  console.log('== StreamLive installer ==');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true
  });

  const dbName = process.env.DB_NAME;
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4`);
  await conn.query(`USE \`${dbName}\``);

  const schema = fs.readFileSync(path.join(__dirname, 'sql', 'schema.sql'), 'utf8');
  await conn.query(schema);
  console.log('✓ Таблицы созданы');

  const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [process.env.ADMIN_EMAIL]);
  if (existing.length === 0) {
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10);
    await conn.query(
      'INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, ?)',
      [process.env.ADMIN_EMAIL, 'admin', hash, 'admin']
    );
    console.log(`✓ Администратор создан: ${process.env.ADMIN_EMAIL} / ${process.env.ADMIN_PASSWORD}`);
  } else {
    console.log('✓ Администратор уже существует, пропускаю');
  }

  // Пресеты популярных OAuth-провайдеров (без ключей — админ вписывает свои в панели)
  const providers = [
    ['google', 'Google', 'https://accounts.google.com/o/oauth2/v2/auth', 'https://oauth2.googleapis.com/token', 'https://www.googleapis.com/oauth2/v3/userinfo', 'openid email profile'],
    ['vk', 'VK', 'https://oauth.vk.com/authorize', 'https://oauth.vk.com/access_token', 'https://api.vk.com/method/users.get', 'email'],
    ['yandex', 'Яндекс', 'https://oauth.yandex.ru/authorize', 'https://oauth.yandex.ru/token', 'https://login.yandex.ru/info', 'login:email login:info']
  ];
  for (const [name, display, authUrl, tokenUrl, profileUrl, scope] of providers) {
    const [rows] = await conn.query('SELECT id FROM oauth_providers WHERE name = ?', [name]);
    if (rows.length === 0) {
      await conn.query(
        `INSERT INTO oauth_providers (name, display_name, auth_url, token_url, profile_url, scope, enabled)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [name, display, authUrl, tokenUrl, profileUrl, scope]
      );
    }
  }
  console.log('✓ Пресеты OAuth-провайдеров добавлены (заполните client_id/secret в /admin/oauth)');

  await conn.end();
  console.log('== Установка завершена. Запускайте: npm start ==');
})().catch(err => {
  console.error('Ошибка установки:', err);
  process.exit(1);
});
