import coffeeCitiesData from "./coffeeShops.json";

export type CoffeeShopDetails = {
  wifi?: string;
  sockets?: string;
  seating?: string;
  hours?: string;
  food?: string;
  notes?: string;
};

export type CoffeeShop = {
  id: string;
  name: string;
  monogram: string;
  coordinates: [number, number];
  description?: string;
  accent: string;
  logoPath?: string | null;
  website?: string;
  neighborhood?: string;
  address?: string;
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
