import { getFirestore } from "firebase-admin/firestore";
import { getFirebaseAdminApp } from "./firebaseAuth.js";

const MAX_PAGE_SIZE = 50;
const BOOK_FIELDS = ["title","author","isbn","asin","cover_url","alt_covers","description","publisher","published_date","page_count","categories","google_books_id","hardcover_id","community_rating","community_ratings_count","shelf_id","shelf_ids","status","notes","review","rating","format","formats","series_name","series_position","romance_subgenre","spice","spice_rating","content_warnings","createdAt","updatedAt"];

export async function getFirebaseAdminFirestore() {
  return getFirestore(await getFirebaseAdminApp());
}

function safePageSize(value) {
  if (value === undefined || value === null || value === "") return MAX_PAGE_SIZE;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new TypeError("Invalid page size");
  return Math.min(parsed, MAX_PAGE_SIZE);
}

export async function listUserBooks({ db, uid, limit }) {
  if (!db || typeof db.collection !== "function") throw new TypeError("A Firestore database is required");
  if (typeof uid !== "string" || !uid || uid.length > 128 || uid.includes("/")) throw new TypeError("A valid Firebase UID is required");
  const pageSize = safePageSize(limit);
  const snapshot = await db.collection("users").doc(uid).collection("books").limit(pageSize).get();
  const books = snapshot.docs.map((document) => {
    const source = document.data() || {};
    const book = { id: document.id };
    for (const field of BOOK_FIELDS) if (Object.hasOwn(source, field)) book[field] = source[field];
    return book;
  });
  return { books, count: books.length };
}
