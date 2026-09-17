import { pool } from '../db.js'

const storeUrlSet =  new Map<string, string>();
const longUrlStoreSet = new Map<string, string>();

export const base62Conversion = (id: number): string =>{
     const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if (id === 0) return chars[0]
     let result = "";
      while (id>0){
        let value = id%62;
        result= chars[value] + result;
        id = Math.floor(id/62);
      }
        return result;
}
let nextId = 0;

export const generateId = (): number => {
  return nextId++;
};

export const checkIfUrlExists = (shortUrl: string): boolean => {
    for (const [shortUrlKey, storedLongUrl] of storeUrlSet) {
        if (shortUrlKey === shortUrl) {
            return true;
        }
    }
    return false;
}
export const storeUrlInMap = (longUrl: string, shortUrl: string): void =>{
    storeUrlSet.set(shortUrl, longUrl);
     longUrlStoreSet.set(longUrl, shortUrl);
}



//database functions
export const getShortUrlFromLongUrl = (longUrl: string): string | undefined =>{
    return longUrlStoreSet.get(longUrl);
}

export const getLongUrlFromShortUrl = (shortUrl: string): string | undefined =>{
    return storeUrlSet.get(shortUrl);
}  
   
export const storeLongUrlInDb = async (longUrl: string,): Promise<number | null> => {
   const result = await pool.query('INSERT INTO urls (long_url) VALUES ($1) ON CONFLICT (long_url) DO NOTHING RETURNING id', [longUrl]);
    const id = result.rows[0].id;
   
    return id ?? null;
}

export const queryLongUrlFromDb = async (id: number): Promise<string | null> => {
    const result = await pool.query('SELECT long_url  FROM  urls  WHERE id = $1', [id])
    return result.rows[0]?.long_url || null;
}

export const queryIdFromDb = async (longUrl: string): Promise<number | null> => {
    const result = await pool.query('SELECT id FROM urls WHERE long_url = $1', [longUrl])
    return result.rows[0]?.id || null;
}

export const checkIfUrlExistsInDb = async (longUrl: string): Promise<boolean> => {
    const result = await pool.query('SELECT id FROM urls WHERE long_url = $1', [longUrl])
    return result.rows.length > 0;
}

export const checkIfShortUrlExistsInDb = async (id: number): Promise<boolean> => {
    const result = await pool.query('SELECT long_url FROM urls WHERE id = $1', [id])
    return result.rows.length > 0;
}

export const Base62ToDecimal = (shortUrl: string): number => {
    const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
   let id =0;
   if (!shortUrl) {
    throw new Error('Short URL cannot be empty');
  }
   for (let i=0; i<shortUrl.length; i++){
    const char = shortUrl[i]
    const value = chars.indexOf(char)
    id = (id *62)+ value
   }
   return id;
}
