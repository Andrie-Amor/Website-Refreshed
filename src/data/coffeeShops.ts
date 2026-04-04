import coffeeCitiesData from "./coffeeShops.json";

export type CoffeeShopHoursEntry = {
  days: string[];
  label: string;
};

export type CoffeeShopDetails = {
  wifi?: boolean;
  sockets?: boolean;
  seating?: boolean;
  hours?: CoffeeShopHoursEntry[];
};

export type CoffeeShop = {
  id: string;
  name: string;
  coordinates: [number, number];
  description?: string;
  accent: string;
  logoPath: string;
  website?: string;
  neighborhood?: string;
  address?: string;
  addressUrl?: string;
  details?: CoffeeShopDetails;
};

export type CoffeeCity = {
  id: string;
  label: string;
  center: [number, number];
  shops: CoffeeShop[];
};

export const coffeeCities = coffeeCitiesData as Record<string, CoffeeCity>;

export const sanFranciscoCoffeeGuide = coffeeCities.sanFrancisco;
