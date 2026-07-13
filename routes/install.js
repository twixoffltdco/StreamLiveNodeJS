const express = require('express');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const router = express.Router();
const ENV_PATH = path.join(__dirname, '..', '.env');
const LOCK_PATH = path.join(__dirname, '..', 'config', 'installed.json');
const SCHEMA_PATH = path.join(__dirname, '..', 'sql', 'schema.sql');

function isInstalled() {
  return fs.existsSync(LOCK_PATH);
}

router.use((req, res, next) => {
  if (isInstalled()) {
    return res.status(200).send(
      '<link rel="stylesheet" href="/css/style.css"><body style="background:#0b0b10;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><h2>StreamLive уже установлен</h2><p style="color:#9a9aac">Если нужно переустановить — удалите config/installed.json и .env на сервере.</p><a href="/" style="color:#25f4ee">На главную</a></div></body>'
    );
  }
  if (!req.session.install) req.session.install = {};
  next();
});

router.get('/', (req, res) => {
  res.render('install/step1_welcome', { layout: false });
});

router.get('/database', (req, res) => {
  res.render('install/step2_database', { layout: false, error: null, values: req.session.install });
});

router.post('/database', async (req, res) => {
  const { site_name, site_url, db_host, db_port, db_name, db_user, db_password } = req.body;
  let conn;
  try {
    conn = await mysql.createConnection({
      host: db_host, port: db_port || 3306, user: db_user, password: db_password
    });
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${db_name}\` CHARACTER SET utf8mb4`);
    await conn.end();
  } catch (e) {
    return res.render('install/step2_database', {
      layout: false,
      error: 'Не удалось подключиться к базе данных: ' + e.message,
      values: req.body
    });
  }

  req.session.install = { site_name, site_url, db_host, db_port, db_name, db_user, db_password };
  res.redirect('/install/admin');
});

router.get('/admin', (req, res) => {
  if (!req.session.install.db_name) return res.redirect('/install/database');
  res.render('install/step3_admin', { layout: false, error: null });
});

router.post('/admin', async (req, res) => {
  const { admin_email, admin_username, admin_password } = req.body;
  const cfg = req.session.install;
  if (!cfg || !cfg.db_name) return res.redirect('/install/database');

  if (!admin_email || !admin_username || !admin_password || admin_password.length < 6) {
    return res.render('install/step3_admin', { layout: false, error: 'Заполните все поля, пароль минимум 6 символов' });
  }

  let conn;
  try {
    conn = await mysql.createConnection({
      host: cfg.db_host, port: cfg.db_port || 3306, user: cfg.db_user,
      password: cfg.db_password, database: cfg.db_name, multipleStatements: true
    });

    const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
    await conn.query(schema);

    const hash = await bcrypt.hash(admin_password, 10);
    await conn.query(
      'INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, "admin")',
      [admin_email, admin_username, hash]
    );

    const providers = [
      ['google', 'Google', 'https://accounts.google.com/o/oauth2/v2/auth', 'https://oauth2.googleapis.com/token', 'https://www.googleapis.com/oauth2/v3/userinfo', 'openid email profile'],
      ['vk', 'VK', 'https://oauth.vk.com/authorize', 'https://oauth.vk.com/access_token', 'https://api.vk.com/method/users.get', 'email'],
      ['yandex', 'Яндекс', 'https://oauth.yandex.ru/authorize', 'https://oauth.yandex.ru/token', 'https://login.yandex.ru/info', 'login:email login:info']
    ];
    for (const [name, display, authUrl, tokenUrl, profileUrl, scope] of providers) {
      await conn.query(
        `INSERT INTO oauth_providers (name, display_name, auth_url, token_url, profile_url, scope, enabled) VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [name, display, authUrl, tokenUrl, profileUrl, scope]
      );
    }
    await conn.end();

    const sessionSecret = crypto.randomBytes(32).toString('hex');
    const envContent = `PORT=3000
SITE_URL=${cfg.site_url}
SITE_NAME=${cfg.site_name}

DB_HOST=${cfg.db_host}
DB_PORT=${cfg.db_port || 3306}
DB_USER=${cfg.db_user}
DB_PASSWORD=${cfg.db_password}
DB_NAME=${cfg.db_name}

SESSION_SECRET=${sessionSecret}
`;
    fs.writeFileSync(ENV_PATH, envContent, 'utf8');
    fs.writeFileSync(LOCK_PATH, JSON.stringify({ installedAt: new Date().toISOString() }, null, 2));

    req.session.install = null;
    res.render('install/step4_done', { layout: false, siteUrl: cfg.site_url });
  } catch (e) {
    console.error(e);
    res.render('install/step3_admin', { layout: false, error: 'Ошибка установки: ' + e.message });
  }
});

module.exports = router;
