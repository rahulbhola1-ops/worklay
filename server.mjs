import express from 'express';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const db = new Database(path.join(__dirname, 'worklay.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = `
CREATE TABLE IF NOT EXISTS wl_users (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,pw_hash TEXT NOT NULL,title TEXT NOT NULL DEFAULT '',country TEXT NOT NULL DEFAULT '',city TEXT NOT NULL DEFAULT '',area TEXT NOT NULL DEFAULT '',bio TEXT NULL,skills TEXT NULL,is_freelancer INTEGER NOT NULL DEFAULT 0,category TEXT NOT NULL DEFAULT '',rate REAL NOT NULL DEFAULT 0,role TEXT NOT NULL DEFAULT 'user',color TEXT NOT NULL DEFAULT '#3858FF',balance REAL NOT NULL DEFAULT 0,ver_status TEXT NOT NULL DEFAULT 'none',ver_doc_type TEXT NULL,ver_file TEXT NULL,ver_file_name TEXT NULL,ver_submitted TEXT NULL,ver_reason TEXT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wl_services (id INTEGER PRIMARY KEY AUTOINCREMENT,seller_id INTEGER NOT NULL,title TEXT NOT NULL,category TEXT NOT NULL,emoji TEXT NOT NULL DEFAULT '💼',color TEXT NOT NULL DEFAULT '#dfe6ff',description TEXT NOT NULL,packages TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wl_projects (id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id INTEGER NOT NULL,title TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,budget_min REAL NOT NULL,budget_max REAL NOT NULL,deadline TEXT NOT NULL,skills TEXT NULL,city TEXT NOT NULL DEFAULT '',area TEXT NOT NULL DEFAULT '',remote INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'open',awarded_to INTEGER NULL,awarded_amount REAL NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wl_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT,project_id INTEGER NOT NULL,seller_id INTEGER NOT NULL,amount REAL NOT NULL,days INTEGER NOT NULL,cover TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(project_id,seller_id));
CREATE TABLE IF NOT EXISTS wl_orders (id INTEGER PRIMARY KEY AUTOINCREMENT,service_id INTEGER NOT NULL,pkg INTEGER NOT NULL,buyer_id INTEGER NOT NULL,seller_id INTEGER NOT NULL,price REAL NOT NULL,requirements TEXT NULL,status TEXT NOT NULL DEFAULT 'in_queue',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wl_reviews (id INTEGER PRIMARY KEY AUTOINCREMENT,target_user INTEGER NOT NULL,from_user INTEGER NOT NULL,service_id INTEGER NULL,order_id INTEGER NULL,project_id INTEGER NULL,rating INTEGER NOT NULL,text TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wl_messages (id INTEGER PRIMARY KEY AUTOINCREMENT,from_id INTEGER NOT NULL,to_id INTEGER NOT NULL,text TEXT NOT NULL,is_read INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wl_notifications (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,type TEXT NOT NULL,text TEXT NOT NULL,link TEXT NOT NULL DEFAULT '',is_read INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wl_wishlist (user_id INTEGER NOT NULL,kind TEXT NOT NULL,item_id INTEGER NOT NULL,PRIMARY KEY(user_id,kind,item_id));
CREATE TABLE IF NOT EXISTS wl_follows (follower INTEGER NOT NULL,followee INTEGER NOT NULL,PRIMARY KEY(follower,followee));
CREATE TABLE IF NOT EXISTS wl_payouts (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,amount REAL NOT NULL,method TEXT NOT NULL,details TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wl_contacts (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,email TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wl_posts (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,emoji TEXT NOT NULL DEFAULT '📝',color TEXT NOT NULL DEFAULT '#eef1ff',excerpt TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS wl_sessions (token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wl_documents (user_id INTEGER PRIMARY KEY,mime TEXT NOT NULL,data BLOB NOT NULL);
`;
db.exec(schema);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
app.use(express.json({ limit: '5mb' }));

const CITIES = {
  Tallinn: ['Haabersti','Kesklinn','Kristiine','Lasnamäe','Mustamäe','Nõmme','Pirita','Põhja-Tallinn'],
  Tartu: ['Annelinn','Karlova','Kesklinn','Maarjamõisa','Ropka','Supilinn','Tammelinn','Ülejõe'],
  Pärnu: ['Kesklinn','Raeküla','Rannarajoon','Vana-Pärnu','Ülejõe'],
  Narva: ['Kalevi','Kesklinn','Kreenholm','Pähklimäe','Soldino'],
  'Kohtla-Järve': ['Ahtme','Järve','Sompa'],
  Viljandi: ['Kesklinn','Paalalinn','Peetrimõisa']
};

function sid(v) { return v === null || v === undefined ? null : String(v); }
function iso(v) { return v ? new Date(v).toISOString().replace('.000Z', 'Z') : new Date().toISOString(); }
function parseCookies(req) {
  const out = {};
  for (const pair of (req.headers.cookie || '').split(';')) {
    const i = pair.indexOf('=');
    if (i > 0) out[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  }
  return out;
}
function me(req) {
  const token = parseCookies(req).worklay_auth;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const session = db.prepare('SELECT * FROM wl_sessions WHERE token_hash=? AND expires_at>datetime(\'now\')').get(hash);
  return session ? db.prepare('SELECT * FROM wl_users WHERE id=?').get(session.user_id) : null;
}
function requireLogin(req, res) {
  const user = me(req);
  if (!user) { res.status(401).json({ error: 'Please log in first.' }); return null; }
  return user;
}
function setAuth(res, token) {
  res.setHeader('Set-Cookie', `worklay_auth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`);
}
function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}
function passwordVerify(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  return crypto.timingSafeEqual(Buffer.from(crypto.scryptSync(password, parts[1], 64).toString('hex')), Buffer.from(parts[2], 'hex'));
}
function notify(userId, type, text, link = '') {
  db.prepare('INSERT INTO wl_notifications(user_id,type,text,link) VALUES (?,?,?,?)').run(userId, type, text, link);
}

app.all('/api', upload.single('doc'), (req, res) => {
  const route = String(req.query.r || '');
  const data = req.method === 'POST' ? req.body : {};
  const user = me(req);

  try {
    if (req.method === 'GET' && route === 'bootstrap') return res.json(bootstrap(req, user));
    if (req.method === 'GET' && route === 'admin/doc') {
      if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admins only.' });
      const doc = db.prepare('SELECT * FROM wl_documents WHERE user_id=?').get(req.query.id);
      if (!doc) return res.status(404).json({ error: 'Document not found.' });
      res.setHeader('Content-Type', doc.mime);
      return res.send(doc.data);
    }

    if (req.method !== 'POST') return res.status(404).json({ error: 'Not found.' });
    switch (route) {
      case 'auth/register': {
        if (!data.email || !data.password) return res.status(400).json({ error: 'Email and password are required.' });
        if (String(data.password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
        if (db.prepare('SELECT id FROM wl_users WHERE email=?').get(String(data.email).toLowerCase())) return res.status(400).json({ error: 'An account already exists with that email.' });
        const info = db.prepare('INSERT INTO wl_users(name,email,pw_hash,title,city,area,is_freelancer,category,color) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(String(data.name || ''), String(data.email).toLowerCase(), passwordHash(String(data.password)), String(data.title || ''), String(data.city || ''), String(data.area || ''), data.intent === 'seller' ? 1 : 0, String(data.category || ''), '#3858FF');
        login(req, res, info.lastInsertRowid);
        return res.json({ ok: true, id: sid(info.lastInsertRowid) });
      }
      case 'auth/login': {
        const u = db.prepare('SELECT * FROM wl_users WHERE email=?').get(String(data.email || '').toLowerCase());
        if (!u || !passwordVerify(String(data.password || ''), u.pw_hash)) return res.status(401).json({ error: 'Invalid email or password.' });
        login(req, res, u.id);
        return res.json({ ok: true, id: sid(u.id) });
      }
      case 'auth/logout': {
        const token = parseCookies(req).worklay_auth;
        if (token) db.prepare('DELETE FROM wl_sessions WHERE token_hash=?').run(crypto.createHash('sha256').update(token).digest('hex'));
        res.setHeader('Set-Cookie', 'worklay_auth=; Path=/; HttpOnly; Max-Age=0');
        return res.json({ ok: true });
      }
      case 'profile/update': {
        const u = requireLogin(req, res); if (!u) return;
        db.prepare('UPDATE wl_users SET name=?,email=?,title=?,city=?,area=?,is_freelancer=?,category=?,rate=?,bio=?,skills=? WHERE id=?')
          .run(String(data.name || u.name), String(data.email || u.email).toLowerCase(), String(data.title || ''), String(data.city || ''), String(data.area || ''), data.isFreelancer ? 1 : 0, String(data.category || ''), Number(data.rate || 0), String(data.bio || ''), JSON.stringify(String(data.skills || '').split(',').map(x => x.trim()).filter(Boolean)), u.id);
        return res.json({ ok: true });
      }
      case 'project/create': {
        const u = requireLogin(req, res); if (!u) return;
        const info = db.prepare('INSERT INTO wl_projects(owner_id,title,category,description,budget_min,budget_max,deadline,skills,city,area,remote) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .run(u.id,String(data.title||''),String(data.category||''),String(data.description||''),Number(data.min||0),Number(data.max||0),String(data.deadline||''),JSON.stringify(String(data.skills||'').split(',').map(x=>x.trim()).filter(Boolean)),String(data.city||''),String(data.area||''),data.remote?1:0);
        return res.json({ ok: true, id: sid(info.lastInsertRowid) });
      }
      case 'service/create': {
        const u = requireLogin(req, res); if (!u) return;
        const info = db.prepare('INSERT INTO wl_services(seller_id,title,category,emoji,description,packages) VALUES (?,?,?,?,?,?)')
          .run(u.id,String(data.title||''),String(data.category||''),String(data.emoji||'💼'),String(data.description||''),JSON.stringify(data.packages||[]));
        return res.json({ ok: true, id: sid(info.lastInsertRowid) });
      }
      case 'proposal/create': {
        const u = requireLogin(req, res); if (!u) return;
        const info = db.prepare('INSERT INTO wl_proposals(project_id,seller_id,amount,days,cover) VALUES (?,?,?,?,?)')
          .run(Number(data.projectId),u.id,Number(data.amount||0),Number(data.days||1),String(data.cover||''));
        return res.json({ ok: true, id: sid(info.lastInsertRowid) });
      }
      case 'proposal/award': return mutateProjectAward(req,res,user,data);
      case 'project/complete': return mutateProjectComplete(req,res,user,data);
      case 'order/create': return mutateOrder(req,res,user,data);
      case 'order/deliver': return mutateOrderStatus(req,res,user,data,'delivered');
      case 'order/accept': return mutateOrderStatus(req,res,user,data,'completed');
      case 'review/create': {
        const u = requireLogin(req,res); if(!u)return;
        let targetUser = Number(data.targetUser||0);
        if (!targetUser && data.orderId) targetUser = db.prepare('SELECT seller_id FROM wl_orders WHERE id=?').get(Number(data.orderId))?.seller_id || 0;
        if (!targetUser && data.projectId) targetUser = db.prepare('SELECT awarded_to FROM wl_projects WHERE id=?').get(Number(data.projectId))?.awarded_to || 0;
        db.prepare('INSERT INTO wl_reviews(target_user,from_user,order_id,project_id,rating,text) VALUES (?,?,?,?,?,?)')
          .run(targetUser,u.id,Number(data.orderId||0)||null,Number(data.projectId||0)||null,Number(data.rating||0),String(data.text||''));
        return res.json({ ok:true });
      }
      case 'message/send': {
        const u=requireLogin(req,res);if(!u)return;
        db.prepare('INSERT INTO wl_messages(from_id,to_id,text) VALUES (?,?,?)').run(u.id,Number(data.to),String(data.text||''));
        notify(Number(data.to),'message',`${u.name} sent you a message.`);
        return res.json({ok:true});
      }
      case 'message/read': {
        const u=requireLogin(req,res);if(!u)return;
        db.prepare('UPDATE wl_messages SET is_read=1 WHERE to_id=? AND from_id=?').run(u.id,Number(data.with));
        return res.json({ok:true});
      }
      case 'notification/read': {
        const u=requireLogin(req,res);if(!u)return;
        db.prepare('UPDATE wl_notifications SET is_read=1 WHERE id=? AND user_id=?').run(Number(data.id),u.id);
        return res.json({ok:true});
      }
      case 'notification/read-all': {
        const u=requireLogin(req,res);if(!u)return;
        db.prepare('UPDATE wl_notifications SET is_read=1 WHERE user_id=?').run(u.id);
        return res.json({ok:true});
      }
      case 'wishlist/toggle': {
        const u=requireLogin(req,res);if(!u)return;
        const existing=db.prepare('SELECT 1 FROM wl_wishlist WHERE user_id=? AND kind=? AND item_id=?').get(u.id,data.kind,Number(data.id));
        if(existing) db.prepare('DELETE FROM wl_wishlist WHERE user_id=? AND kind=? AND item_id=?').run(u.id,data.kind,Number(data.id));
        else db.prepare('INSERT INTO wl_wishlist(user_id,kind,item_id) VALUES (?,?,?)').run(u.id,data.kind,Number(data.id));
        return res.json({ok:true,saved:!existing});
      }
      case 'follow/toggle': {
        const u=requireLogin(req,res);if(!u)return;
        const existing=db.prepare('SELECT 1 FROM wl_follows WHERE follower=? AND followee=?').get(u.id,Number(data.id));
        if(existing) db.prepare('DELETE FROM wl_follows WHERE follower=? AND followee=?').run(u.id,Number(data.id));
        else db.prepare('INSERT INTO wl_follows(follower,followee) VALUES (?,?)').run(u.id,Number(data.id));
        return res.json({ok:true,following:!existing});
      }
      case 'payout/request': {
        const u=requireLogin(req,res);if(!u)return;
        db.prepare('INSERT INTO wl_payouts(user_id,amount,method,details) VALUES (?,?,?,?)').run(u.id,Number(data.amount||0),String(data.method||''),String(data.details||''));
        return res.json({ok:true});
      }
      case 'contact/send':
        db.prepare('INSERT INTO wl_contacts(name,email,message) VALUES (?,?,?)').run(String(data.name||''),String(data.email||''),String(data.message||''));
        return res.json({ok:true});
      case 'verification/submit': {
        const u=requireLogin(req,res);if(!u)return;
        if(!req.file)return res.status(400).json({error:'Please choose a file.'});
        db.prepare('INSERT INTO wl_documents(user_id,mime,data) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET mime=excluded.mime,data=excluded.data').run(u.id,req.file.mimetype,req.file.buffer);
        db.prepare('UPDATE wl_users SET ver_status=\'pending\',ver_doc_type=?,ver_file=?,ver_file_name=?,ver_submitted=datetime(\'now\') WHERE id=?')
          .run(String(data.docType||'ID card'),'stored',req.file.originalname,u.id);
        return res.json({ok:true});
      }
      case 'admin/verify': {
        if(!user||user.role!=='admin')return res.status(403).json({error:'Admins only.'});
        db.prepare('UPDATE wl_users SET ver_status=?,ver_reason=? WHERE id=?').run(data.ok?'verified':'rejected',String(data.reason||''),Number(data.id));
        db.prepare('DELETE FROM wl_documents WHERE user_id=?').run(Number(data.id));
        return res.json({ok:true});
      }
      case 'admin/payout-paid': {
        if(!user||user.role!=='admin')return res.status(403).json({error:'Admins only.'});
        db.prepare('UPDATE wl_payouts SET status=\'paid\' WHERE id=?').run(Number(data.id));
        return res.json({ok:true});
      }
      default: return res.status(404).json({error:'Not found.'});
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'A database error occurred. Please try again.' });
  }
});

function login(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT OR REPLACE INTO wl_sessions(token_hash,user_id,expires_at) VALUES (?,?,datetime(\'now\',\'+30 days\'))')
    .run(crypto.createHash('sha256').update(token).digest('hex'), userId);
  setAuth(res, token);
}

function bootstrap(req, user) {
  const mid = user ? user.id : 0;
  const admin = !!user && user.role === 'admin';
  const users = db.prepare('SELECT * FROM wl_users ORDER BY id').all().map(u => {
    const self = u.id === mid;
    const stats = {
      inQueue: db.prepare('SELECT COUNT(*) c FROM wl_orders WHERE seller_id=? AND status<>\'completed\'').get(u.id).c,
      doneServices: db.prepare('SELECT COUNT(*) c FROM wl_orders WHERE seller_id=? AND status=\'completed\'').get(u.id).c,
      doneProjects: db.prepare('SELECT COUNT(*) c FROM wl_projects WHERE awarded_to=? AND status=\'completed\'').get(u.id).c
    };
    const out = {
      id: sid(u.id), name: u.name, title: u.title, country: u.country, city: u.city, area: u.area,
      bio: u.bio || '', skills: JSON.parse(u.skills || '[]'), isFreelancer: !!u.is_freelancer,
      category: u.category, rate: u.rate, role: u.role, color: u.color, joined: iso(u.created_at),
      verification: { status: u.ver_status }, stats, balance: self ? u.balance : 0
    };
    if (self || admin) {
      out.email = u.email;
      out.verification = { status:u.ver_status,docType:u.ver_doc_type,fileName:u.ver_file_name,submitted:u.ver_submitted?iso(u.ver_submitted):null,reason:u.ver_reason,hasDoc:!!u.ver_file };
    }
    return out;
  });
  const services = db.prepare('SELECT * FROM wl_services ORDER BY id DESC').all().map(s => ({
    id:sid(s.id),sellerId:sid(s.seller_id),title:s.title,category:s.category,emoji:s.emoji,color:s.color,
    description:s.description,packages:JSON.parse(s.packages||'[]'),created:iso(s.created_at)
  }));
  const projects = db.prepare('SELECT p.*, (SELECT COUNT(*) FROM wl_proposals x WHERE x.project_id=p.id) proposalCount FROM wl_projects p ORDER BY p.id DESC').all().map(p => ({
    id:sid(p.id),ownerId:sid(p.owner_id),title:p.title,category:p.category,description:p.description,
    budgetMin:p.budget_min,budgetMax:p.budget_max,deadline:p.deadline,skills:JSON.parse(p.skills||'[]'),
    city:p.city,area:p.area,remote:!!p.remote,status:p.status,awardedTo:sid(p.awarded_to),
    awardedAmount:p.awarded_amount,proposalCount:p.proposalCount,created:iso(p.created_at)
  }));
  const proposals = mid ? db.prepare(`SELECT * FROM wl_proposals WHERE seller_id=? OR project_id IN (SELECT id FROM wl_projects WHERE owner_id=? ) ORDER BY id DESC`).all(mid,mid).map(p => ({
    id:sid(p.id),projectId:sid(p.project_id),sellerId:sid(p.seller_id),amount:p.amount,days:p.days,cover:p.cover,status:p.status,created:iso(p.created_at)
  })) : [];
  const orders = mid ? db.prepare('SELECT * FROM wl_orders WHERE buyer_id=? OR seller_id=? ORDER BY id DESC').all(mid,mid).map(o => ({
    id:sid(o.id),serviceId:sid(o.service_id),pkg:o.pkg,buyerId:sid(o.buyer_id),sellerId:sid(o.seller_id),
    price:o.price,status:o.status,created:iso(o.created_at)
  })) : [];
  const reviews = db.prepare('SELECT * FROM wl_reviews ORDER BY id DESC').all().map(r => ({
    id:sid(r.id),targetUser:sid(r.target_user),from:sid(r.from_user),serviceId:sid(r.service_id),orderId:sid(r.order_id),
    projectId:sid(r.project_id),rating:r.rating,text:r.text,date:iso(r.created_at)
  }));
  const messages = mid ? db.prepare('SELECT * FROM wl_messages WHERE from_id=? OR to_id=? ORDER BY id').all(mid,mid).map(m => ({
    id:sid(m.id),from:sid(m.from_id),to:sid(m.to_id),text:m.text,read:!!m.is_read,date:iso(m.created_at)
  })) : [];
  const notifications = mid ? db.prepare('SELECT * FROM wl_notifications WHERE user_id=? ORDER BY id DESC LIMIT 100').all(mid).map(n => ({
    id:sid(n.id),userId:sid(n.user_id),type:n.type,text:n.text,link:n.link,read:!!n.is_read,date:iso(n.created_at)
  })) : [];
  const wishlist = mid ? db.prepare('SELECT kind,item_id FROM wl_wishlist WHERE user_id=?').all(mid).map(w=>({kind:w.kind,id:sid(w.item_id)})) : [];
  const follows = mid ? db.prepare('SELECT followee FROM wl_follows WHERE follower=?').all(mid).map(f=>sid(f.followee)) : [];
  const payouts = admin ? db.prepare('SELECT * FROM wl_payouts ORDER BY id DESC').all().map(p=>({
    id:sid(p.id),userId:sid(p.user_id),amount:p.amount,method:p.method,details:p.details,status:p.status,created:iso(p.created_at)
  })) : (mid ? db.prepare('SELECT * FROM wl_payouts WHERE user_id=? ORDER BY id DESC').all(mid).map(p=>({
    id:sid(p.id),userId:sid(p.user_id),amount:p.amount,method:p.method,details:p.details,status:p.status,created:iso(p.created_at)
  })) : []);
  const posts = db.prepare('SELECT * FROM wl_posts ORDER BY id DESC').all().map(p=>({
    id:sid(p.id),title:p.title,emoji:p.emoji,color:p.color,excerpt:p.excerpt,body:p.body,created:iso(p.created_at)
  }));
  return { me:user ? sid(user.id) : null, users,services,projects,proposals,orders,reviews,messages,notifications,wishlist,follows,payouts,posts,
    config:{cities:CITIES,fee:0.10,minPayout:20,payoutMethods:['PayPal','Payoneer','Bank transfer']} };
}

function mutateProjectAward(req,res,user,data) {
  const u=requireLogin(req,res);if(!u)return;
  const pr=db.prepare('SELECT * FROM wl_proposals WHERE id=?').get(Number(data.id));
  if(!pr)return res.status(404).json({error:'Proposal not found.'});
  const project=db.prepare('SELECT * FROM wl_projects WHERE id=?').get(pr.project_id);
  if(!project||project.owner_id!==u.id)return res.status(403).json({error:'Project owner only.'});
  db.prepare('UPDATE wl_projects SET status=\'awarded\',awarded_to=?,awarded_amount=? WHERE id=?').run(pr.seller_id,pr.amount,project.id);
  db.prepare('UPDATE wl_proposals SET status=? WHERE id=?').run('accepted',pr.id);
  notify(pr.seller_id,'project','You were awarded a project.',`#/project/${project.id}`);
  return res.json({ok:true});
}

function mutateProjectComplete(req,res,user,data) {
  const u=requireLogin(req,res);if(!u)return;
  const p=db.prepare('SELECT * FROM wl_projects WHERE id=?').get(Number(data.id));
  if(!p||p.owner_id!==u.id)return res.status(403).json({error:'Project owner only.'});
  db.prepare('UPDATE wl_projects SET status=\'completed\' WHERE id=?').run(p.id);
  if(p.awarded_to) db.prepare('UPDATE wl_users SET balance=balance+? WHERE id=?').run(p.awarded_amount||0,p.awarded_to);
  return res.json({ok:true});
}

function mutateOrder(req,res,user,data) {
  const u=requireLogin(req,res);if(!u)return;
  const service=db.prepare('SELECT * FROM wl_services WHERE id=?').get(Number(data.serviceId));
  if(!service)return res.status(404).json({error:'Service not found.'});
  const packages=JSON.parse(service.packages||'[]');
  const pkg=packages[Number(data.pkg)||0];
  if(!pkg)return res.status(404).json({error:'Package not found.'});
  const info=db.prepare('INSERT INTO wl_orders(service_id,pkg,buyer_id,seller_id,price,requirements) VALUES (?,?,?,?,?,?)')
    .run(service.id,Number(data.pkg)||0,u.id,service.seller_id,Number(pkg.price||0),String(data.requirements||''));
  notify(service.seller_id,'order','You have a new order.',`#/dashboard/orders`);
  return res.json({ok:true,id:sid(info.lastInsertRowid)});
}

function mutateOrderStatus(req,res,user,data,status) {
  const u=requireLogin(req,res);if(!u)return;
  const o=db.prepare('SELECT * FROM wl_orders WHERE id=?').get(Number(data.id));
  if(!o)return res.status(404).json({error:'Order not found.'});
  if(status==='delivered'&&o.seller_id!==u.id)return res.status(403).json({error:'Seller only.'});
  if(status==='completed'&&o.buyer_id!==u.id)return res.status(403).json({error:'Buyer only.'});
  db.prepare('UPDATE wl_orders SET status=? WHERE id=?').run(status,o.id);
  if(status==='completed')db.prepare('UPDATE wl_users SET balance=balance+? WHERE id=?').run(o.price,o.seller_id);
  return res.json({ok:true});
}

if (!process.argv.includes('--dev')) {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.use((req,res)=>res.sendFile(path.join(__dirname,'dist','index.html')));
}

const port = process.argv.includes('--dev') ? 3001 : Number(process.env.PORT || 5173);
app.listen(port, '127.0.0.1', () => console.log(`Worklay Node API listening on http://127.0.0.1:${port}`));

