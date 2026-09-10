const Database = require('better-sqlite3');
const path = require('path');
const { nanoid } = require('nanoid');

const DEFAULT_DB_PATH = path.join(__dirname, 'database.db');

/** @type {import('better-sqlite3').Database | null} */
let db = null;

const MENU_SEED = [
  {
    name: 'Chicken Biryani',
    description: 'Fragrant basmati rice with spiced chicken',
    price_paise: 29900,
    stock: 12,
    category: 'Mains',
    image_url: null,
  },
  {
    name: 'Paneer Butter Masala',
    description: 'Cottage cheese in tomato-butter gravy',
    price_paise: 24900,
    stock: 20,
    category: 'Mains',
    image_url: null,
  },
  {
    name: 'Dal Tadka',
    description: 'Yellow lentils tempered with ghee and spices',
    price_paise: 14900,
    stock: 30,
    category: 'Mains',
    image_url: null,
  },
  {
    name: 'Butter Naan',
    description: 'Soft tandoor flatbread with butter',
    price_paise: 4900,
    stock: 50,
    category: 'Breads',
    image_url: null,
  },
  {
    name: 'Garlic Naan',
    description: 'Naan topped with garlic and coriander',
    price_paise: 5900,
    stock: 40,
    category: 'Breads',
    image_url: null,
  },
  {
    name: 'Masala Papad',
    description: 'Crispy papad with onion-tomato topping',
    price_paise: 7900,
    stock: 25,
    category: 'Starters',
    image_url: null,
  },
  {
    name: 'Chicken Tikka',
    description: 'Chargrilled chicken with tikka marinade',
    price_paise: 27900,
    stock: 15,
    category: 'Starters',
    image_url: null,
  },
  {
    name: 'Veg Spring Rolls',
    description: 'Crispy rolls with mixed vegetables',
    price_paise: 12900,
    stock: 18,
    category: 'Starters',
    image_url: null,
  },
  {
    name: 'Mango Lassi',
    description: 'Sweet yogurt drink with mango pulp',
    price_paise: 9900,
    stock: 35,
    category: 'Drinks',
    image_url: null,
  },
  {
    name: 'Masala Chai',
    description: 'Spiced Indian tea with milk',
    price_paise: 3900,
    stock: 60,
    category: 'Drinks',
    image_url: null,
  },
  {
    name: 'Gulab Jamun',
    description: 'Milk dumplings in sugar syrup (2 pcs)',
    price_paise: 8900,
    stock: 22,
    category: 'Desserts',
    image_url: null,
  },
  {
    name: 'Rasmalai',
    description: 'Soft cheese discs in saffron milk (2 pcs)',
    price_paise: 11900,
    stock: 16,
    category: 'Desserts',
    image_url: null,
  },
];

/**
 * @param {{ dbPath?: string, force?: boolean }} [options]
 */
function initDb(options = {}) {
  const dbPath = options.dbPath ?? process.env.DB_PATH ?? DEFAULT_DB_PATH;

  if (db && !options.force) {
    return db;
  }
  if (db) {
    db.close();
    db = null;
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      price_paise INTEGER NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL,
      image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS group_sessions (
      id TEXT PRIMARY KEY,
      join_code TEXT UNIQUE NOT NULL,
      host_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS session_participants (
      session_id TEXT NOT NULL REFERENCES group_sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      is_host INTEGER NOT NULL DEFAULT 0,
      joined_at INTEGER NOT NULL,
      PRIMARY KEY (session_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES group_sessions(id),
      total_paise INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'placed',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id TEXT NOT NULL REFERENCES menu_items(id),
      qty INTEGER NOT NULL,
      price_paise INTEGER NOT NULL,
      added_by TEXT NOT NULL,
      UNIQUE(order_id, menu_item_id, added_by)
    );
  `);

  seedMenuIfEmpty(db);
  return db;
}

/**
 * @param {import('better-sqlite3').Database} database
 */
function seedMenuIfEmpty(database) {
  const row = database.prepare('SELECT COUNT(*) AS count FROM menu_items').get();
  if (!row || typeof row.count !== 'number') {
    throw new Error('Failed to read menu_items count');
  }
  if (row.count > 0) {
    return;
  }

  const insert = database.prepare(`
    INSERT INTO menu_items (id, name, description, price_paise, stock, category, image_url)
    VALUES (@id, @name, @description, @price_paise, @stock, @category, @image_url)
  `);

  const seedAll = database.transaction(() => {
    for (let i = 0; i < MENU_SEED.length; i += 1) {
      const item = MENU_SEED[i];
      insert.run({
        id: nanoid(10),
        name: item.name,
        description: item.description,
        price_paise: item.price_paise,
        stock: item.stock,
        category: item.category,
        image_url: item.image_url,
      });
    }
  });

  seedAll();
}

function closeDb() {
  if (!db) {
    return;
  }
  db.close();
  db = null;
}

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

function getMenuItems() {
  const database = getDb();
  return database
    .prepare(
      `SELECT id, name, description, price_paise, stock, category, image_url
       FROM menu_items
       ORDER BY category ASC, name ASC`
    )
    .all();
}

module.exports = {
  initDb,
  closeDb,
  getDb,
  getMenuItems,
  MENU_SEED,
  DB_PATH: DEFAULT_DB_PATH,
};
