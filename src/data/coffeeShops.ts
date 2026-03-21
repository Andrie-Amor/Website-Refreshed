export type CoffeeShop = {
  id: string;
  name: string;
  monogram: string;
  coordinates: [number, number];
  description?: string;
  accent: string;
};

export type CoffeeCity = {
  id: string;
  label: string;
  center: [number, number];
  shops: CoffeeShop[];
};

export const sanFranciscoCoffeeGuide: CoffeeCity = {
  id: "san-francisco",
  label: "San Francisco, California",
  center: [-122.433, 37.764],
  shops: [
    {
      id: "saint-frank",
      name: "Saint Frank Coffee",
      monogram: "SF",
      coordinates: [-122.423, 37.7974],
      description:
        "Bright, polished Russian Hill cafe with expressive espresso and a calm, design-forward room.",
      accent: "#b77b5c",
    },
    {
      id: "four-barrel",
      name: "Four Barrel Coffee",
      monogram: "FB",
      coordinates: [-122.4215, 37.767],
      description:
        "Mission mainstay for deeper roasts, strong music curation, and a warehouse-scale coffee bar.",
      accent: "#8b6f60",
    },
    {
      id: "sightglass",
      name: "Sightglass Coffee",
      monogram: "SG",
      coordinates: [-122.4089, 37.7769],
      description:
        "Airy SoMa flagship with multi-level seating and a roasting setup that makes the whole space feel alive.",
      accent: "#6e7f72",
    },
    {
      id: "andytown",
      name: "Andytown Coffee Roasters",
      monogram: "AT",
      coordinates: [-122.4968, 37.7532],
      description:
        "Outer Sunset favorite with a neighborhood feel, surf energy, and an easy post-beach stop.",
      accent: "#5f7d8c",
    },
    {
      id: "ritual",
      name: "Ritual Coffee Roasters",
      monogram: "RC",
      coordinates: [-122.4248, 37.7769],
      description:
        "Reliable Hayes Valley stop for clean pour-overs and a quick downtown detour without feeling rushed.",
      accent: "#927b63",
    },
    {
      id: "the-mill",
      name: "The Mill",
      monogram: "TM",
      coordinates: [-122.4376, 37.7763],
      description:
        "Minimal NOPA bakery-cafe pairing excellent coffee with thick toast and a slower morning tempo.",
      accent: "#b08f68",
    },
    {
      id: "linea",
      name: "Linea Caffe",
      monogram: "LC",
      coordinates: [-122.414, 37.753],
      description:
        "Compact Mission bar with serious espresso, warm light, and just enough outdoor seating to linger.",
      accent: "#8f7569",
    },
    {
      id: "coffee-movement",
      name: "The Coffee Movement",
      monogram: "CM",
      coordinates: [-122.4083, 37.7954],
      description:
        "Tiny downtown shop with meticulous drinks and a sharply edited menu that feels product-level precise.",
      accent: "#6f8574",
    },
  ],
};

export const coffeeCities: Record<string, CoffeeCity> = {
  sanFrancisco: sanFranciscoCoffeeGuide,
};
