const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const OAuth2Strategy = require('passport-oauth2');
const bcrypt = require('bcryptjs');
const db = require('./db');

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    done(null, rows[0] || null);
  } catch (e) { done(e); }
});

passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    const user = rows[0];
    if (!user || !user.password_hash) return done(null, false, { message: 'Неверный email или пароль' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return done(null, false, { message: 'Неверный email или пароль' });
    if (user.is_banned) return done(null, false, { message: 'Аккаунт заблокирован' });
    done(null, user);
  } catch (e) { done(e); }
}));

// Динамически регистрируем OAuth2-стратегии для каждого включённого провайдера из БД.
// Это позволяет админу добавлять/включать соцсети (VK, Google, Яндекс и т.д.) без деплоя нового кода.
async function loadOAuthProviders() {
  const [providers] = await db.query('SELECT * FROM oauth_providers WHERE enabled = 1');
  for (const p of providers) {
    if (!p.client_id || !p.client_secret) continue;
    const strategyName = `oauth2-${p.name}`;
    passport.unuse(strategyName);
    passport.use(strategyName, new OAuth2Strategy({
      authorizationURL: p.auth_url,
      tokenURL: p.token_url,
      clientID: p.client_id,
      clientSecret: p.client_secret,
      callbackURL: `${process.env.SITE_URL}/auth/${p.name}/callback`,
      scope: p.scope || ''
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        // Универсальный fetch профиля — конкретные провайдеры (vk/google/yandex)
        // отдают разные поля, поэтому берём то, что находим, с фоллбэком на id токена.
        const resp = await fetch(p.profile_url, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
        const data = await resp.json();
        const oauthId = String(data.id || data.sub || data.response?.[0]?.id || accessToken.slice(0, 16));
        const email = data.email || data.default_email || null;
        const displayName = data.name || data.login || data.first_name || `${p.display_name}_${oauthId}`;

        const [existing] = await db.query(
          'SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?',
          [p.name, oauthId]
        );
        if (existing.length) return done(null, existing[0]);

        const username = `${p.name}_${oauthId}`.slice(0, 64);
        const [result] = await db.query(
          'INSERT INTO users (email, username, oauth_provider, oauth_id, avatar) VALUES (?, ?, ?, ?, ?)',
          [email, username, p.name, oauthId, data.picture || data.avatar_url || null]
        );
        const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [result.insertId]);
        done(null, rows[0]);
      } catch (e) { done(e); }
    }));
  }
}

module.exports = { passport, loadOAuthProviders };
