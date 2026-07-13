const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { ensureAdmin } = require('../middleware/auth');
const { loadOAuthProviders } = require('../config/passport');

router.use(ensureAdmin);

router.get('/', async (req, res) => {
  const [[{ pending }]] = await db.query(`SELECT COUNT(*) pending FROM channels WHERE status = 'pending'`);
  const [[{ total }]] = await db.query(`SELECT COUNT(*) total FROM channels`);
  const [[{ users }]] = await db.query(`SELECT COUNT(*) users FROM users`);
  res.render('admin/dashboard', { title: 'Админ-панель', pending, total, users });
});

// Модерация: список каналов на рассмотрении
router.get('/moderation', async (req, res) => {
  const [channels] = await db.query(
    `SELECT c.*, u.username as owner_name FROM channels c JOIN users u ON u.id = c.owner_id
     WHERE c.status = 'pending' ORDER BY c.created_at ASC`
  );
  res.render('admin/moderation', { title: 'Модерация каналов', channels });
});

router.post('/moderation/:id/approve', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM channels WHERE id = ?', [req.params.id]);
  const channel = rows[0];
  if (!channel) return res.redirect('/admin/moderation');
  await db.query('UPDATE channels SET status = "approved", reject_reason = NULL WHERE id = ?', [channel.id]);
  await db.query(
    'INSERT INTO notifications (user_id, channel_id, type, message) VALUES (?, ?, ?, ?)',
    [channel.owner_id, channel.id, 'channel_approved', `Канал «${channel.title}» прошёл модерацию и опубликован в каталоге`]
  );
  req.flash('success', 'Канал одобрен');
  res.redirect('/admin/moderation');
});

router.post('/moderation/:id/reject', async (req, res) => {
  const { reason } = req.body;
  const [rows] = await db.query('SELECT * FROM channels WHERE id = ?', [req.params.id]);
  const channel = rows[0];
  if (!channel) return res.redirect('/admin/moderation');
  await db.query('UPDATE channels SET status = "rejected", reject_reason = ? WHERE id = ?', [reason || null, channel.id]);
  await db.query(
    'INSERT INTO notifications (user_id, channel_id, type, message) VALUES (?, ?, ?, ?)',
    [channel.owner_id, channel.id, 'channel_rejected', `Канал «${channel.title}» отклонён: ${reason || 'без указания причины'}`]
  );
  req.flash('success', 'Канал отклонён, автору отправлено уведомление');
  res.redirect('/admin/moderation');
});

// Возможность в любой момент снять уже одобренный канал с публикации
router.get('/channels', async (req, res) => {
  const [channels] = await db.query(
    `SELECT c.*, u.username as owner_name FROM channels c JOIN users u ON u.id = c.owner_id ORDER BY c.created_at DESC`
  );
  res.render('admin/channels', { title: 'Все каналы', channels });
});

router.post('/channels/:id/takedown', async (req, res) => {
  const { reason } = req.body;
  const [rows] = await db.query('SELECT * FROM channels WHERE id = ?', [req.params.id]);
  const channel = rows[0];
  if (!channel) return res.redirect('/admin/channels');
  await db.query('UPDATE channels SET status = "rejected", reject_reason = ? WHERE id = ?', [reason || 'Нарушение правил платформы', channel.id]);
  await db.query(
    'INSERT INTO notifications (user_id, channel_id, type, message) VALUES (?, ?, ?, ?)',
    [channel.owner_id, channel.id, 'channel_rejected', `Канал «${channel.title}» снят с публикации: ${reason || 'нарушение правил'}`]
  );
  req.flash('success', 'Канал снят с публикации');
  res.redirect('/admin/channels');
});

router.post('/channels/:id/delete', async (req, res) => {
  await db.query('DELETE FROM channels WHERE id = ?', [req.params.id]);
  req.flash('success', 'Канал удалён');
  res.redirect('/admin/channels');
});

// Стандартные источники, доступные всем владельцам каналов
router.get('/sources', async (req, res) => {
  const [sources] = await db.query('SELECT * FROM sources WHERE created_by IS NULL ORDER BY id DESC');
  res.render('admin/sources', { title: 'Стандартные источники', sources });
});

router.post('/sources', async (req, res) => {
  const { name, type, url } = req.body;
  await db.query('INSERT INTO sources (name, type, url, created_by) VALUES (?, ?, ?, NULL)', [name, type, url]);
  res.redirect('/admin/sources');
});

router.post('/sources/:id/delete', async (req, res) => {
  await db.query('DELETE FROM sources WHERE id = ? AND created_by IS NULL', [req.params.id]);
  res.redirect('/admin/sources');
});

// Настройка OAuth соц. авторизации (Google/VK/Яндекс и любые другие OAuth2)
router.get('/oauth', async (req, res) => {
  const [providers] = await db.query('SELECT * FROM oauth_providers ORDER BY id');
  res.render('admin/oauth', { title: 'Соц. авторизация', providers });
});

router.post('/oauth/:id', async (req, res) => {
  const { display_name, icon_url, client_id, client_secret, auth_url, token_url, profile_url, scope, enabled } = req.body;
  await db.query(
    `UPDATE oauth_providers SET display_name=?, icon_url=?, client_id=?, client_secret=?, auth_url=?, token_url=?, profile_url=?, scope=?, enabled=?
     WHERE id = ?`,
    [display_name, icon_url, client_id, client_secret, auth_url, token_url, profile_url, scope, enabled ? 1 : 0, req.params.id]
  );
  await loadOAuthProviders(); // перечитать стратегии без рестарта сервера
  req.flash('success', 'Провайдер обновлён');
  res.redirect('/admin/oauth');
});

router.post('/oauth', async (req, res) => {
  const { name, display_name, icon_url, auth_url, token_url, profile_url, scope } = req.body;
  await db.query(
    `INSERT INTO oauth_providers (name, display_name, icon_url, auth_url, token_url, profile_url, scope, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
    [name, display_name, icon_url, auth_url, token_url, profile_url, scope]
  );
  res.redirect('/admin/oauth');
});

// Пользователи
router.get('/users', async (req, res) => {
  const [users] = await db.query('SELECT id, email, username, role, is_banned, created_at FROM users ORDER BY id DESC');
  res.render('admin/users', { title: 'Пользователи', users });
});

router.post('/users/:id/ban', async (req, res) => {
  await db.query('UPDATE users SET is_banned = 1 WHERE id = ?', [req.params.id]);
  res.redirect('/admin/users');
});

router.post('/users/:id/unban', async (req, res) => {
  await db.query('UPDATE users SET is_banned = 0 WHERE id = ?', [req.params.id]);
  res.redirect('/admin/users');
});

router.post('/users/:id/role', async (req, res) => {
  await db.query('UPDATE users SET role = ? WHERE id = ?', [req.body.role, req.params.id]);
  res.redirect('/admin/users');
});

router.get('/database', async (req, res) => {
  try {
    const [dbInfo] = await db.query(
      'SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
      [process.env.DB_NAME]
    );
    const [tableCount] = await db.query(
      'SELECT COUNT(*) as cnt FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ?',
      [process.env.DB_NAME]
    );
    const [[{ users }]] = await db.query('SELECT COUNT(*) users FROM users');
    const [[{ channels }]] = await db.query('SELECT COUNT(*) channels FROM channels');
    const [[{ messages }]] = await db.query('SELECT COUNT(*) messages FROM chat_messages');
    
    res.render('admin/database', {
      title: 'Обслуживание базы данных',
      dbInfo: dbInfo[0] || {},
      tableCount: tableCount[0]?.cnt || 0,
      users,
      channels,
      messages
    });
  } catch (e) {
    console.error('Database info error:', e);
    res.render('admin/database', {
      title: 'Обслуживание базы данных',
      error: e.message,
      dbInfo: {},
      tableCount: 0,
      users: 0,
      channels: 0,
      messages: 0
    });
  }
});

router.post('/database/update-charset', async (req, res) => {
  try {
    const tables = [
      'users', 'oauth_providers', 'sources', 'channels', 'schedule',
      'chat_moderators', 'chat_bans', 'stickers', 'chat_messages',
      'notifications', 'sessions'
    ];
    
    await db.query('ALTER DATABASE ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [process.env.DB_NAME]);
    
    for (const table of tables) {
      try {
        await db.query('ALTER TABLE ?? CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [table]);
      } catch (e) {
        console.log('Skipping table ' + table + ':', e.message);
      }
    }
    
    req.flash('success', 'База данных успешно обновлена на utf8mb4. Все таблицы и данные сохранены.');
    res.redirect('/admin/database');
  } catch (e) {
    console.error('Charset update error:', e);
    req.flash('error', 'Ошибка при обновлении: ' + e.message);
    res.redirect('/admin/database');
  }
});

module.exports = router;
