import map from "./india-states.json";

/**
 * State outlines pre-projected by scripts/build-india-map.py (data:
 * udit-001/india-maps-data). The projection below must match that script so
 * city points land in the right place.
 */
export const INDIA = map as unknown as {
  projection: { lon0: number; lat1: number; k: number; scale: number };
  viewBox: [number, number, number, number];
  states: { code: string; name: string; d: string }[];
};

export function project(lon: number, lat: number): [number, number] {
  const { lon0, lat1, k, scale } = INDIA.projection;
  return [(lon - lon0) * k * scale, (lat1 - lat) * scale];
}

/** Retail zones for states with no stores to infer from. */
export const DEFAULT_REGION: Record<string, string> = {
  "Jammu and Kashmir": "North", Ladakh: "North", "Himachal Pradesh": "North", Punjab: "North",
  Chandigarh: "North", Haryana: "North", Delhi: "North", Uttarakhand: "North", "Uttar Pradesh": "North",
  Rajasthan: "North",
  Gujarat: "West", Maharashtra: "West", Goa: "West", "Madhya Pradesh": "West",
  "Dadra and Nagar Haveli and Daman and Diu": "West",
  Karnataka: "South", Kerala: "South", "Tamil Nadu": "South", "Andhra Pradesh": "South", Telangana: "South",
  Puducherry: "South", Lakshadweep: "South", "Andaman and Nicobar Islands": "South",
  "West Bengal": "East", Bihar: "East", Jharkhand: "East", Odisha: "East", Chhattisgarh: "East", Sikkim: "East",
  Assam: "East", "Arunachal Pradesh": "East", Nagaland: "East", Manipur: "East", Mizoram: "East",
  Tripura: "East", Meghalaya: "East",
};

/** Where each region's label sits on the India view: inland spots with few stores, so labels don't cover dots. */
export const REGION_LABEL_AT: Record<string, { lat: number; lon: number }> = {
  North: { lat: 27.4, lon: 72.4 },
  West: { lat: 24.3, lon: 79.6 },
  South: { lat: 15.6, lon: 78.3 },
  East: { lat: 21.3, lon: 84.2 },
};

type City = { lat: number; lon: number; state: string };

/** Store cities (and common aliases). Unknown cities just don't get a dot. */
const CITIES: Record<string, City> = {
  "Delhi NCR": { lat: 28.61, lon: 77.21, state: "Delhi" },
  Delhi: { lat: 28.61, lon: 77.21, state: "Delhi" },
  "New Delhi": { lat: 28.61, lon: 77.21, state: "Delhi" },
  Gurugram: { lat: 28.46, lon: 77.03, state: "Haryana" },
  Gurgaon: { lat: 28.46, lon: 77.03, state: "Haryana" },
  Noida: { lat: 28.54, lon: 77.39, state: "Uttar Pradesh" },
  Ghaziabad: { lat: 28.67, lon: 77.45, state: "Uttar Pradesh" },
  Faridabad: { lat: 28.41, lon: 77.32, state: "Haryana" },
  Chandigarh: { lat: 30.73, lon: 76.78, state: "Chandigarh" },
  Mohali: { lat: 30.7, lon: 76.72, state: "Punjab" },
  Ludhiana: { lat: 30.9, lon: 75.85, state: "Punjab" },
  Amritsar: { lat: 31.63, lon: 74.87, state: "Punjab" },
  Jalandhar: { lat: 31.33, lon: 75.58, state: "Punjab" },
  Dehradun: { lat: 30.32, lon: 78.03, state: "Uttarakhand" },
  Jaipur: { lat: 26.91, lon: 75.79, state: "Rajasthan" },
  Udaipur: { lat: 24.59, lon: 73.71, state: "Rajasthan" },
  Jodhpur: { lat: 26.24, lon: 73.02, state: "Rajasthan" },
  Lucknow: { lat: 26.85, lon: 80.95, state: "Uttar Pradesh" },
  Kanpur: { lat: 26.45, lon: 80.33, state: "Uttar Pradesh" },
  Varanasi: { lat: 25.32, lon: 82.97, state: "Uttar Pradesh" },
  Agra: { lat: 27.18, lon: 78.01, state: "Uttar Pradesh" },
  Jammu: { lat: 32.73, lon: 74.86, state: "Jammu and Kashmir" },
  Mumbai: { lat: 19.08, lon: 72.88, state: "Maharashtra" },
  "Navi Mumbai": { lat: 19.03, lon: 73.03, state: "Maharashtra" },
  Thane: { lat: 19.22, lon: 72.98, state: "Maharashtra" },
  Pune: { lat: 18.52, lon: 73.86, state: "Maharashtra" },
  Nagpur: { lat: 21.15, lon: 79.09, state: "Maharashtra" },
  Nashik: { lat: 20.0, lon: 73.79, state: "Maharashtra" },
  Ahmedabad: { lat: 23.02, lon: 72.57, state: "Gujarat" },
  Surat: { lat: 21.17, lon: 72.83, state: "Gujarat" },
  Vadodara: { lat: 22.31, lon: 73.18, state: "Gujarat" },
  Rajkot: { lat: 22.3, lon: 70.8, state: "Gujarat" },
  Goa: { lat: 15.5, lon: 73.83, state: "Goa" },
  Panaji: { lat: 15.5, lon: 73.83, state: "Goa" },
  Indore: { lat: 22.72, lon: 75.86, state: "Madhya Pradesh" },
  Bhopal: { lat: 23.26, lon: 77.41, state: "Madhya Pradesh" },
  Bengaluru: { lat: 12.97, lon: 77.59, state: "Karnataka" },
  Bangalore: { lat: 12.97, lon: 77.59, state: "Karnataka" },
  Mysuru: { lat: 12.3, lon: 76.64, state: "Karnataka" },
  Mysore: { lat: 12.3, lon: 76.64, state: "Karnataka" },
  Mangaluru: { lat: 12.91, lon: 74.86, state: "Karnataka" },
  Hubli: { lat: 15.36, lon: 75.12, state: "Karnataka" },
  Hyderabad: { lat: 17.39, lon: 78.49, state: "Telangana" },
  Chennai: { lat: 13.08, lon: 80.27, state: "Tamil Nadu" },
  Coimbatore: { lat: 11.02, lon: 76.96, state: "Tamil Nadu" },
  Madurai: { lat: 9.93, lon: 78.12, state: "Tamil Nadu" },
  Kochi: { lat: 9.93, lon: 76.27, state: "Kerala" },
  Thiruvananthapuram: { lat: 8.52, lon: 76.94, state: "Kerala" },
  Kozhikode: { lat: 11.26, lon: 75.78, state: "Kerala" },
  Visakhapatnam: { lat: 17.69, lon: 83.22, state: "Andhra Pradesh" },
  Vijayawada: { lat: 16.51, lon: 80.65, state: "Andhra Pradesh" },
  Puducherry: { lat: 11.94, lon: 79.81, state: "Puducherry" },
  Kolkata: { lat: 22.57, lon: 88.36, state: "West Bengal" },
  Siliguri: { lat: 26.73, lon: 88.4, state: "West Bengal" },
  Patna: { lat: 25.59, lon: 85.14, state: "Bihar" },
  Ranchi: { lat: 23.34, lon: 85.31, state: "Jharkhand" },
  Jamshedpur: { lat: 22.8, lon: 86.2, state: "Jharkhand" },
  Bhubaneswar: { lat: 20.3, lon: 85.82, state: "Odisha" },
  Raipur: { lat: 21.25, lon: 81.63, state: "Chhattisgarh" },
  Guwahati: { lat: 26.14, lon: 91.74, state: "Assam" },
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const BY_NORM = new Map(Object.entries(CITIES).map(([name, city]) => [norm(name), city]));

export function cityInfo(name: string): (City & { x: number; y: number }) | null {
  const city = BY_NORM.get(norm(name));
  if (!city) return null;
  const [x, y] = project(city.lon, city.lat);
  return { ...city, x, y };
}
