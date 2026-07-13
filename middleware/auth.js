function ensureAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  req.flash('error', 'Нужно войти в аккаунт');
  res.redirect('/auth/login');
}

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'admin') return next();
  res.status(403).render('error', { title: 'Доступ запрещён', message: 'Только для администраторов' });
}

function ensureNotBanned(req, res, next) {
  if (req.isAuthenticated() && req.user.is_banned) {
    return res.status(403).render('error', { title: 'Аккаунт заблокирован', message: 'Обратитесь к администрации' });
  }
  next();
}

module.exports = { ensureAuth, ensureAdmin, ensureNotBanned };
