const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { passport } = require('../config/passport');
const db = require('../config/db');

router.get('/login', async (req, res) => {
  const [providers] = await db.query('SELECT name, display_name, icon_url FROM oauth_providers WHERE enabled = 1');
  res.render('auth/login', { title: 'Вход', providers });
});

router.post('/login', passport.authenticate('local', {
  successRedirect: '/dashboard',
  failureRedirect: '/auth/login',
  failureFlash: true
}));

router.get('/register', async (req, res) => {
  const [providers] = await db.query('SELECT name, display_name, icon_url FROM oauth_providers WHERE enabled = 1');
  res.render('auth/register', { title: 'Регистрация', providers });
});

router.post('/register', async (req, res) => {
  const { email, username, password } = req.body;
  try {
    const [dupe] = await db.query('SELECT id FROM users WHERE email = ? OR username = ?', [email, username]);
    if (dupe.length) {
      req.flash('error', 'Такой email или логин уже занят');
      return res.redirect('/auth/register');
    }
    const hash = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)', [email, username, hash]);
    req.flash('success', 'Регистрация успешна, теперь войдите');
    res.redirect('/auth/login');
  } catch (e) {
    console.error(e);
    req.flash('error', 'Ошибка регистрации');
    res.redirect('/auth/register');
  }
});

// Динамические соц. провайдеры: /auth/vk, /auth/google, /auth/yandex ...
router.get('/:provider', (req, res, next) => {
  const strategy = `oauth2-${req.params.provider}`;
  if (!passport._strategy(strategy)) return res.status(404).send('Провайдер не настроен');
  passport.authenticate(strategy)(req, res, next);
});

router.get('/:provider/callback', (req, res, next) => {
  const strategy = `oauth2-${req.params.provider}`;
  passport.authenticate(strategy, {
    successRedirect: '/dashboard',
    failureRedirect: '/auth/login'
  })(req, res, next);
});

router.post('/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

module.exports = router;
