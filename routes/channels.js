const express = require('express');
const router = express.Router();
const { nanoid } = require('nanoid');
const db = require('../config/db');
const { ensureAuth, ensureNotBanned } = require('../middleware/auth');

function slugify(title) {
  const translit = title.toLowerCase()
    .replace(/[^a-zа-я0-9\s-]/gi, '')
    .trim().replace(/\s+/g, '-');
  return `${translit || 'channel'}-${nanoid(6)}`.toLowerCase();
}

// Каталог одобренных каналов (стиль TikTok — вертикальная лента карточек)
router.get('/', async (req, res) => {
  const type = req.query.type === 'radio' ? 'radio' : (req.query.type === 'tv' ? 'tv' : null);
  let sql = `SELECT id, slug, title, logo_url, type, views FROM channels WHERE status = 'approved'`;
  const params = [];
  if (type) { sql += ' AND type = ?'; params.push(type); }
  sql += ' ORDER BY views DESC, created_at DESC LIMIT 60';
  const [channels] = await db.query(sql, params);
  res.render('catalog', { title: 'StreamLive — каталог каналов и радио', channels, activeType: type });
});

router.get('/shorts', async (req, res) => {
  const viewed = (req.cookies.viewed_channels || '').split(',').filter(Boolean).map(Number);
  let sql = `SELECT id, slug, title, logo_url, type, views FROM channels WHERE status = 'approved'`;
  let channels;
  if (viewed.length > 0) {
    sql += ` ORDER BY FIELD(id, ${viewed.join(',')}) ASC, RAND() LIMIT 20`;
    [channels] = await db.query(sql);
  } else {
    sql += ` ORDER BY RAND() LIMIT 20`;
    [channels] = await db.query(sql);
  }
  res.render('shorts', { title: 'Shorts', channels });
});

router.get('/new', ensureAuth, ensureNotBanned, async (req, res) => {
  const [sources] = await db.query('SELECT * FROM sources WHERE created_by IS NULL');
  res.render('channel_new', { title: 'Создать канал', sources });
});

router.post('/new', ensureAuth, ensureNotBanned, async (req, res) => {
  const { title, description, type, logo_url, default_source_id } = req.body;
  const slug = slugify(title);
  await db.query(
    `INSERT INTO channels (owner_id, slug, title, description, type, logo_url, default_source_id, seo_title, seo_description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, slug, title, description, type, logo_url || null, default_source_id || null, title, (description || '').slice(0, 380)]
  );
  req.flash('success', 'Канал отправлен на модерацию');
  res.redirect('/dashboard');
});

// Личный кабинет владельца — список своих каналов + управление
router.get('/dashboard', ensureAuth, async (req, res) => {
  const [channels] = await db.query('SELECT * FROM channels WHERE owner_id = ? ORDER BY created_at DESC', [req.user.id]);
  const [notifications] = await db.query(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20', [req.user.id]
  );
  res.render('dashboard', { title: 'Мои каналы', channels, notifications });
});

router.get('/manage/:id', ensureAuth, async (req, res) => {
  const [rows] = await db.query('SELECT * FROM channels WHERE id = ? AND owner_id = ?', [req.params.id, req.user.id]);
  const channel = rows[0];
  if (!channel) return res.status(404).render('error', { title: 'Не найдено', message: 'Канал не найден' });
  const [sources] = await db.query('SELECT * FROM sources WHERE created_by IS NULL OR created_by = ?', [req.user.id]);
  const [schedule] = await db.query('SELECT * FROM schedule WHERE channel_id = ? ORDER BY day_of_week, start_time', [channel.id]);
  const [stickers] = await db.query('SELECT * FROM stickers WHERE channel_id = ?', [channel.id]);
  const [mods] = await db.query(
    `SELECT u.id, u.username FROM chat_moderators cm JOIN users u ON u.id = cm.user_id WHERE cm.channel_id = ?`,
    [channel.id]
  );
  res.render('channel_manage', { title: `Управление: ${channel.title}`, channel, sources, schedule, stickers, mods });
});

router.post('/manage/:id', ensureAuth, async (req, res) => {
  const { title, description, logo_url, default_source_id, seo_title, seo_description, seo_keywords } = req.body;
  await db.query(
    `UPDATE channels SET title=?, description=?, logo_url=?, default_source_id=?, seo_title=?, seo_description=?, seo_keywords=?
     WHERE id = ? AND owner_id = ?`,
    [title, description, logo_url || null, default_source_id || null, seo_title, seo_description, seo_keywords, req.params.id, req.user.id]
  );
  req.flash('success', 'Настройки сохранены');
  res.redirect(`/channels/manage/${req.params.id}`);
});

// Добавить свой источник (прямая ссылка / m3u8 / встраиваемая платформа)
router.post('/manage/:id/sources', ensureAuth, async (req, res) => {
  const { name, type, url } = req.body;
  await db.query('INSERT INTO sources (name, type, url, created_by) VALUES (?, ?, ?, ?)', [name, type, url, req.user.id]);
  res.redirect(`/channels/manage/${req.params.id}`);
});

// Расписание эфира пн-вс
router.post('/manage/:id/schedule', ensureAuth, async (req, res) => {
  const [own] = await db.query('SELECT id FROM channels WHERE id=? AND owner_id=?', [req.params.id, req.user.id]);
  if (!own.length) return res.status(403).end();
  const { day_of_week, start_time, end_time, source_id, program_title } = req.body;
  await db.query(
    'INSERT INTO schedule (channel_id, day_of_week, start_time, end_time, source_id, program_title) VALUES (?, ?, ?, ?, ?, ?)',
    [req.params.id, day_of_week, start_time, end_time, source_id, program_title || null]
  );
  res.redirect(`/channels/manage/${req.params.id}`);
});

router.post('/manage/:id/schedule/:sid/delete', ensureAuth, async (req, res) => {
  const [own] = await db.query('SELECT id FROM channels WHERE id=? AND owner_id=?', [req.params.id, req.user.id]);
  if (!own.length) return res.status(403).end();
  await db.query('DELETE FROM schedule WHERE id = ? AND channel_id = ?', [req.params.sid, req.params.id]);
  res.redirect(`/channels/manage/${req.params.id}`);
});

// Кастомные стикеры канала
router.post('/manage/:id/stickers', ensureAuth, async (req, res) => {
  const [own] = await db.query('SELECT id FROM channels WHERE id=? AND owner_id=?', [req.params.id, req.user.id]);
  if (!own.length) return res.status(403).end();
  const { code, image_url } = req.body;
  await db.query('INSERT INTO stickers (channel_id, code, image_url) VALUES (?, ?, ?)', [req.params.id, code, image_url]);
  res.redirect(`/channels/manage/${req.params.id}`);
});

// Назначить модератора чата по username
router.post('/manage/:id/moderators', ensureAuth, async (req, res) => {
  const [own] = await db.query('SELECT id FROM channels WHERE id=? AND owner_id=?', [req.params.id, req.user.id]);
  if (!own.length) return res.status(403).end();
  const [u] = await db.query('SELECT id FROM users WHERE username = ?', [req.body.username]);
  if (u.length) {
    await db.query('INSERT IGNORE INTO chat_moderators (channel_id, user_id) VALUES (?, ?)', [req.params.id, u[0].id]);
  }
  res.redirect(`/channels/manage/${req.params.id}`);
});

// Находит активный источник по расписанию на текущий момент, иначе default_source_id
async function resolveActiveSource(channel) {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // JS: 0=Вс -> переводим в 0=Пн..6=Вс
  const time = now.toTimeString().slice(0, 8);
  const [rows] = await db.query(
    `SELECT s.*, sch.program_title FROM schedule sch
     JOIN sources s ON s.id = sch.source_id
     WHERE sch.channel_id = ? AND sch.day_of_week = ? AND sch.start_time <= ? AND sch.end_time > ?
     LIMIT 1`,
    [channel.id, dow, time, time]
  );
  if (rows.length) return rows[0];
  if (channel.default_source_id) {
    const [d] = await db.query('SELECT * FROM sources WHERE id = ?', [channel.default_source_id]);
    return d[0] || null;
  }
  return null;
}

// Публичная страница канала — плеер + чат + SEO
router.get('/:slug', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM channels WHERE slug = ?', [req.params.slug]);
  const channel = rows[0];
  if (!channel) return res.status(404).render('error', { title: 'Канал не найден', message: 'Такого канала не существует' });

  if (channel.status !== 'approved') {
    return res.status(403).render('error', {
      title: 'Канал недоступен',
      message: channel.status === 'pending'
        ? 'Канал ещё проходит модерацию и пока не допущен в каталог'
        : `Канал не был допущен в каталог${channel.reject_reason ? `: ${channel.reject_reason}` : ''}`
    });
  }

  // Каждое открытие страницы = один просмотр
  await db.query('UPDATE channels SET views = views + 1 WHERE id = ?', [channel.id]);

  const activeSource = await resolveActiveSource(channel);
  const [stickers] = await db.query('SELECT * FROM stickers WHERE channel_id = ?', [channel.id]);
  const [schedule] = await db.query('SELECT sch.*, s.name as source_name FROM schedule sch JOIN sources s ON s.id = sch.source_id WHERE channel_id = ? ORDER BY day_of_week, start_time', [channel.id]);

  res.render('channel_view', {
    title: channel.seo_title || channel.title,
    seoDescription: channel.seo_description || channel.description || '',
    seoKeywords: channel.seo_keywords || '',
    channel, activeSource, stickers, schedule,
    embed: false
  });
});

// Отдельный embed-роут для встраивания на сторонние сайты (только плеер, без обвязки)
router.get('/:slug/embed', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM channels WHERE slug = ? AND status = "approved"', [req.params.slug]);
  const channel = rows[0];
  if (!channel) return res.status(404).send('Канал недоступен');
  await db.query('UPDATE channels SET views = views + 1 WHERE id = ?', [channel.id]);
  const activeSource = await resolveActiveSource(channel);
  res.render('channel_embed', { title: channel.title, channel, activeSource });
});

module.exports = router;
