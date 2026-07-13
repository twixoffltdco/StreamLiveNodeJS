const db = require('../config/db');

module.exports = function initChat(io, sharedSession) {
  io.use((socket, next) => sharedSession(socket.request, {}, next));

  io.on('connection', (socket) => {
    const req = socket.request;

    socket.on('join', async ({ channelId }) => {
      if (!channelId) return;
      socket.join(`channel:${channelId}`);
      socket.data.channelId = channelId;
    });

    socket.on('chat:message', async ({ channelId, message }) => {
      try {
        // Получаем user ID из сессии
        const userId = req.session?.passport?.user;
        
        if (!userId) {
          socket.emit('chat:error', { message: 'Нужно войти в аккаунт' });
          return;
        }

        if (!channelId || !message || !message.trim()) {
          socket.emit('chat:error', { message: 'Неверные данные' });
          return;
        }

        const cleanMessage = message.trim().slice(0, 500);

        // Проверяем бан
        const [banned] = await db.query(
          'SELECT id FROM chat_bans WHERE channel_id = ? AND user_id = ?',
          [channelId, userId]
        );
        if (banned.length) {
          socket.emit('chat:error', { message: 'Вы забанены в этом чате' });
          return;
        }

        // Получаем username
        const [uRows] = await db.query(
          'SELECT username FROM users WHERE id = ?',
          [userId]
        );
        const username = uRows[0]?.username || 'User';

        // Вставляем сообщение
        const [result] = await db.query(
          'INSERT INTO chat_messages (channel_id, user_id, message) VALUES (?, ?, ?)',
          [channelId, userId, cleanMessage]
        );

        // Отправляем всем в канале
        io.to(`channel:${channelId}`).emit('chat:message', {
          id: result.insertId,
          channelId,
          userId,
          username,
          message: cleanMessage,
          createdAt: new Date()
        });

      } catch (e) {
        console.error('chat:message error:', e);
        socket.emit('chat:error', { message: 'Ошибка сервера' });
      }
    });

    // Модератор/владелец удаляет сообщение
    socket.on('chat:delete', async ({ channelId, messageId }) => {
      try {
        const userId = req.session?.passport?.user;
        if (!userId) return;

        const isMod = await canModerate(channelId, userId);
        if (!isMod) return;

        await db.query(
          'UPDATE chat_messages SET is_deleted = 1 WHERE id = ? AND channel_id = ?',
          [messageId, channelId]
        );

        io.to(`channel:${channelId}`).emit('chat:deleted', { messageId });
      } catch (e) {
        console.error('chat:delete error:', e);
      }
    });

    // Модератор/владелец банит зрителя в чате
    socket.on('chat:ban', async ({ channelId, targetUserId }) => {
      try {
        const userId = req.session?.passport?.user;
        if (!userId) return;

        const isMod = await canModerate(channelId, userId);
        if (!isMod) return;

        await db.query(
          'INSERT IGNORE INTO chat_bans (channel_id, user_id) VALUES (?, ?)',
          [channelId, targetUserId]
        );

        io.to(`channel:${channelId}`).emit('chat:banned', { userId: targetUserId });
      } catch (e) {
        console.error('chat:ban error:', e);
      }
    });
  });

  async function canModerate(channelId, userId) {
    try {
      if (!userId) return false;

      const [owner] = await db.query(
        'SELECT id FROM channels WHERE id = ? AND owner_id = ?',
        [channelId, userId]
      );
      if (owner.length) return true;

      const [mod] = await db.query(
        'SELECT id FROM chat_moderators WHERE channel_id = ? AND user_id = ?',
        [channelId, userId]
      );
      return mod.length > 0;
    } catch (e) {
      console.error('canModerate error:', e);
      return false;
    }
  }
};
