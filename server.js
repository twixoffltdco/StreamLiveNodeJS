require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const session = require('express-session');

const LOCK_PATH = path.join(__dirname, 'config', 'installed.json');
const app = express();
const server = http.createServer(app);

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

if (!fs.existsSync(LOCK_PATH)) {
  // ---- Bootstrap-режим: приложение ещё не установлено ----
  // Используем сессию в памяти (без БД, её ещё нет) только для шагов мастера установки.
  app.use(session({
    secret: 'streamlive-install-bootstrap',
    resave: false,
    saveUninitialized: true
  }));
  app.use('/install', require('./routes/install'));
  app.get('*', (req, res) => res.redirect('/install'));

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`StreamLive не установлен. Откройте http://localhost:${PORT}/install для установки.`);
  });
  return;
}

// ---- Полноценный режим (после установки) ----
const MySQLStore = require('express-mysql-session')(session);
const flash = require('connect-flash');
const { Server } = require('socket.io');

const db = require('./config/db');
const { passport, loadOAuthProviders } = require('./config/passport');
const initChat = require('./sockets/chat');

const io = new Server(server);

const sessionStore = new MySQLStore({}, db);
const sessionMiddleware = session({
  key: 'streamlive_sid',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
});

app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.siteName = process.env.SITE_NAME || 'StreamLive';
  next();
});

// Мастер установки уже пройден — блокируем повторный доступ
app.use('/install', (req, res) => {
  res.status(200).send('StreamLive уже установлен. Чтобы переустановить — удалите config/installed.json и .env на сервере.');
});

app.use('/auth', require('./routes/auth'));
app.use('/channels', require('./routes/channels'));
app.use('/admin', require('./routes/admin'));

app.get('/dashboard', (req, res) => res.redirect('/channels/dashboard'));
app.get('/', (req, res) => res.redirect('/channels'));

app.use((req, res) => {
  res.status(404).render('error', { title: '404', message: 'Страница не найдена' });
});

initChat(io, sessionMiddleware);

const PORT = process.env.PORT || 3000;

loadOAuthProviders().then(() => {
  server.listen(PORT, () => {
    console.log(`StreamLive запущен на ${process.env.SITE_URL || 'http://localhost:' + PORT}`);
  });
});
