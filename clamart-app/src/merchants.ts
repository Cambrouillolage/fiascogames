import { supabase } from './supabaseClient.ts';

export interface Category {
  id: string;
  label: string;
  emoji: string;
  color: string;
  parent_id: string | null;
  sort_order: number;
  badge_id: string | null;
  public_landmark_hint: boolean;
}

// Forme renvoyée par la vue publique `clamart_merchants_public` (voir
// supabase/migrations/0010_clamart_merchants_public_view.sql) : `name` y
// arrive déjà masqué ("La****") côté serveur pour un commerce verrouillé,
// et description/address/postal_code/photo_url/website/phone/opening_hours
// y sont déjà à `null` dans ce cas — rien à masquer nous-mêmes ici. La
// position (lat/lon) n'est elle PAS masquée : le verrouillage GAV est une
// mécanique ludique de découverte sur la carte, pas une promesse
// d'anonymisation du lieu (voir README du pack de catégories).
export interface Merchant {
  id: string;
  name: string;
  category_id: string;
  subcategory_id: string | null;
  description: string | null;
  address: string | null;
  postal_code: string | null;
  city: string | null;
  lat: number | null;
  lon: number | null;
  photo_url: string | null;
  status: 'active' | 'inactive';
  pointer_type: string;
  badge_icon: string | null;
  badge_color: string | null;
  badge_id: string | null;
  website: string | null;
  phone: string | null;
  opening_hours: string | null;
  is_locked: boolean;
  gav_stock_quantity: number | null;
}

export async function loadCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('clamart_categories')
    .select('id, label, emoji, color, parent_id, sort_order, badge_id, public_landmark_hint')
    .order('sort_order', { ascending: true });
  if (error) {
    console.error('loadCategories', error);
    return [];
  }
  return data ?? [];
}

/**
 * Commerçants actifs avec une position connue, déjà filtrés/masqués
 * côté serveur par la vue `clamart_merchants_public` — jamais la table
 * brute `clamart_merchants` depuis le client public (voir migration 0010 :
 * le nom complet d'un commerce verrouillé ne doit pas être récupérable via
 * une requête directe).
 */
export async function loadActiveMerchants(): Promise<Merchant[]> {
  const { data, error } = await supabase
    .from('clamart_merchants_public')
    .select(
      'id, name, category_id, subcategory_id, description, address, postal_code, city, lat, lon, photo_url, status, pointer_type, badge_icon, badge_color, badge_id, website, phone, opening_hours, is_locked, gav_stock_quantity'
    )
    .not('lat', 'is', null)
    .not('lon', 'is', null);
  if (error) {
    console.error('loadActiveMerchants', error);
    return [];
  }
  return data ?? [];
}

export function googleMapsDirectionsUrl(merchant: Merchant): string | null {
  if (merchant.lat == null || merchant.lon == null) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${merchant.lat},${merchant.lon}`;
}

// Même projection équirectangulaire que scripts/fetch-osm.ts (toLocalMeters),
// reparamétrée par un centre passé en argument : les commerçants viennent
// de Supabase en lat/lon, pas déjà en mètres locaux comme les données OSM
// précalculées, donc la conversion doit aussi exister côté client.
const M_PER_DEG_LAT = 111_320;
export function latLonToLocalMeters(
  lat: number,
  lon: number,
  center: { lat: number; lon: number }
): [number, number] {
  const metersPerDegLon = M_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180);
  const x = (lon - center.lon) * metersPerDegLon;
  const y = (lat - center.lat) * M_PER_DEG_LAT;
  return [x, y];
}
