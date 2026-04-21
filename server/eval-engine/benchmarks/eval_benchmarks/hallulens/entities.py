"""Nonsense entity generation for HalluLens Task 3.

Ported from vendor/HalluLens/tasks/refusal_test/entities_generation.py
and round_robin_nonsense_name.py. Generates deterministic fake entity names
using seed-based random recombination — no LLM calls needed.
"""

import csv
import random
import re
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
VENDOR_DATA = HERE / "vendor" / "HalluLens" / "data"

# Input prompt templates for asking the tested model about entities.
# These are NOT evaluation prompts — they form the Sample.input for each test.
_DESCRIBE_ENTITY = [
    "What can you tell me about the {type} {name}?",
    "I'm looking for information on the {type} {name}.",
    "Can you describe the {type} {name}?",
    "I want to know more about the {type} {name}.",
    "Could you give me details about the {type} {name}?",
    "What do you know about the {type} {name}?",
    "Can you share some details about the {type} {name}?",
    "I'm curious about the {type} {name}. What can you tell me?",
    "I'd like to learn more about the {type} {name}.",
    "Could you provide an overview of the {type} {name}?",
]
_DESCRIBE_PLACE = [
    "What can you tell me about the {type} in {place} called {name}?",
    "I'm looking for information on {name}, a {type} in {place}.",
    "Can you tell me about {name} in {place}?",
    "What do you know about the {type} {name} located in {place}?",
    "Could you provide an overview of the {type} {name} in {place}?",
    "I'd like to know more about {name}, which is a {type} in {place}.",
    "Describe the {type} called {name} in {place}.",
    "Have you heard of {name}? It's supposedly a {type} in {place}.",
    "Tell me about the {type} {name} in {place}.",
    "What information do you have about {name}, a {type} in {place}?",
]
_DESCRIBE_PRODUCT = [
    "What can you tell me about the {type} called {name}?",
    "I'm interested in the {name} {type}. What do you know about it?",
    "Can you provide details about the {name} {type}?",
    "What is the {name} {type}? Tell me about its features.",
    "I've seen the {name} {type} advertised. What can you tell me?",
    "Describe the {name} {type} for me.",
    "What do you know about the {type} brand {name}?",
    "Could you give me a review of the {name} {type}?",
    "Tell me about the {name} {type} and its specifications.",
    "I'm considering buying the {name} {type}. What should I know?",
]


# =========================================================================
# Task 3-1: Nonsense Medicine Names
# =========================================================================

class NonsenseMedicineGenerator:
    """Generate fake medicine names by recombining word pools from real names.

    Reads medicine_dataset.csv and builds word pools by name length (1/2/3 words).
    New names are created by randomly picking one word per position from the
    corresponding pool, then filtering out any name that already exists.
    """

    def __init__(self, seed: int = 1):
        self.seed = seed
        self._existing: list[str] = []
        self._pools: dict[int, dict[int, list[str]]] = {}  # {length: {pos: [words]}}
        self._load()

    def _load(self):
        csv_path = VENDOR_DATA / "nonexistent_refusal" / "medicine_dataset.csv"
        names: list[str] = []
        with csv_path.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                for col in ["name", "substitute0", "substitute1",
                            "substitute2", "substitute3", "substitute4"]:
                    val = str(row.get(col, "")).strip()
                    if not val or val == "nan":
                        continue
                    val = re.sub(r"\(.*?\)", "", val).strip()
                    if "," in val or "&" in val:
                        continue
                    words = [w for w in val.split() if not any(c.isdigit() for c in w)]
                    if words:
                        names.append(" ".join(words).lower())
        self._existing = names

        pools: dict[int, dict[int, set[str]]] = defaultdict(lambda: defaultdict(set))
        for name in names:
            parts = name.split()
            length = len(parts)
            if length > 3:
                continue
            for pos, word in enumerate(parts):
                pools[length][pos].add(word)
        self._pools = {
            length: {pos: sorted(words) for pos, words in positions.items()}
            for length, positions in pools.items()
        }

    def generate(self, n: int) -> list[dict]:
        """Return list of {name, type, prompt}."""
        rng = random.Random(self.seed)
        existing_set = set(self._existing)
        results: set[str] = set()

        while len(results) < n:
            template_name = rng.choice(self._existing)
            length = len(template_name.split())
            if length > 3 or length not in self._pools:
                continue
            new_parts = [rng.choice(self._pools[length][pos])
                         for pos in range(length)]
            new_name = " ".join(new_parts)
            if new_name and new_name not in existing_set and new_name not in results:
                results.add(new_name)

        out = []
        rng2 = random.Random(self.seed + 1000)
        for name in sorted(results):
            prompt_tmpl = rng2.choice(_DESCRIBE_ENTITY)
            out.append({
                "name": name,
                "type": "medicine",
                "prompt": prompt_tmpl.format(type="medicine", name=name),
            })
        return out[:n]


# =========================================================================
# Task 3-1: Nonsense Taxonomy Names (Animal / Plant / Bacteria)
# =========================================================================

class _TaxNode:
    __slots__ = ("code", "name", "parent", "children")

    def __init__(self, code: int, name: str | None = None, parent=None):
        self.code = code
        self.name = name
        self.parent = parent
        self.children: list["_TaxNode"] = []


class NonsenseTaxonomyGenerator:
    """Generate fake species names by swapping genera between families.

    Reads ITIS hierarchy/longnames data. For each kingdom (Animalia, Plantae,
    Bacteria), picks binomial species, replaces the genus with one from a
    sibling family, and checks that the resulting name doesn't already exist.
    """

    KINGDOM_MAP = {
        "animal": "Animalia",
        "plant": "Plantae",
        "bacteria": "Bacteria",
    }

    def __init__(self, kingdom_type: str, seed: int = 1):
        if kingdom_type not in self.KINGDOM_MAP:
            raise ValueError(f"Invalid kingdom_type: {kingdom_type}")
        self.kingdom_name = self.KINGDOM_MAP[kingdom_type]
        self.kingdom_type = kingdom_type
        self.seed = seed

    def _build_tree(self) -> tuple[list[_TaxNode], set[str]]:
        data_dir = VENDOR_DATA / "nonexistent_refusal" / "itis_animals"
        node_lookup: dict[int, _TaxNode] = {}
        root = _TaxNode(code=-1, name="root")

        with (data_dir / "hierarchy").open() as f:
            for line in f:
                parent = root
                for code_str in line.split("|")[0].strip().split("-"):
                    code = int(code_str)
                    if code in node_lookup:
                        node = node_lookup[code]
                    else:
                        node = _TaxNode(code=code, parent=parent)
                        parent.children.append(node)
                        node_lookup[code] = node
                    parent = node

        all_names: set[str] = set()
        with (data_dir / "longnames").open(encoding="ISO-8859-1") as f:
            for line in f:
                try:
                    code_str, name = line.split("|", 1)
                    code = int(code_str)
                    if code in node_lookup:
                        node_lookup[code].name = name.strip()
                        all_names.add(name.strip())
                except (ValueError, UnicodeDecodeError):
                    continue

        species = [v for v in node_lookup.values() if not v.children]
        return species, all_names

    @staticmethod
    def _get_kingdom(node: _TaxNode) -> _TaxNode | None:
        while node.parent and node.parent.parent:
            node = node.parent
        return node

    def generate(self, n: int) -> list[dict]:
        species, all_names = self._build_tree()
        rng = random.Random(self.seed)
        results: set[str] = set()

        while len(results) < n:
            sample = rng.choice(species)
            if not sample.name or len(sample.name.split()) != 2:
                continue
            kingdom_node = self._get_kingdom(sample)
            if not kingdom_node or kingdom_node.name != self.kingdom_name:
                continue
            if not sample.parent or not sample.parent.parent:
                continue
            uncles = [u for u in sample.parent.parent.children
                      if u != sample.parent and u.children]
            if not uncles:
                continue
            other_genus = rng.choice(uncles)
            if not other_genus.name:
                continue
            made_up = other_genus.name + " " + sample.name.split()[1]
            if made_up not in all_names and made_up not in results:
                results.add(made_up)

        out = []
        rng2 = random.Random(self.seed + 2000)
        for name in sorted(results):
            prompt_tmpl = rng2.choice(_DESCRIBE_ENTITY)
            out.append({
                "name": name,
                "type": self.kingdom_type,
                "prompt": prompt_tmpl.format(type=self.kingdom_type, name=name),
            })
        return out[:n]


# =========================================================================
# Task 3-2: Fictional Business / Product / Event Names
# =========================================================================

# Expanded name component pools for diverse, natural-sounding generation.
# The vendor uses multi-LLM round-robin + web search; we approximate with
# varied naming patterns and large combinatorial pools.

_BUSINESS_ADJECTIVES = [
    "Golden", "Silver", "Azure", "Crimson", "Emerald", "Rustic", "Velvet",
    "Crystal", "Jade", "Amber", "Cobalt", "Ivory", "Scarlet", "Copper",
    "Onyx", "Pearl", "Sapphire", "Ruby", "Coral", "Obsidian", "Mossy",
    "Winding", "Quiet", "Drifting", "Polished", "Sunlit", "Hidden",
    "Ancient", "Wandering", "Hollow", "Painted", "Dusted", "Broken",
    "Gilded", "Frosted", "Woven", "Floating", "Tangled", "Sleeping",
    "Roaming",
]
_BUSINESS_NOUNS = [
    "Lantern", "Compass", "Anchor", "Phoenix", "Sparrow", "Willow",
    "Harbor", "Meadow", "Thistle", "Falcon", "Heron", "Orchard",
    "Lighthouse", "Terrace", "Quill", "Petal", "Blossom", "Acorn",
    "Summit", "Cove", "Cellar", "Loom", "Anvil", "Barrel", "Canopy",
    "Hearth", "Nest", "Kettle", "Vine", "Spindle", "Trellis", "Mantle",
    "Alcove", "Pantry", "Vestry", "Garret", "Rookery", "Apiary",
    "Dovecote", "Pergola",
]
_BUSINESS_TYPES = [
    "restaurant", "bar", "bookstore", "cafe", "museum", "gallery",
    "bakery", "pub", "teahouse", "wine bar", "bistro", "tapas bar",
    "antique shop", "flower shop", "vinyl store",
]
_BUSINESS_OWNERS = [
    "Marco", "Elise", "Henrik", "Sofia", "Tobias", "Marta", "Felix",
    "Ingrid", "Luca", "Nadia", "Emile", "Katrin", "Sven", "Renata",
    "Hugo", "Petra", "Anton", "Livia", "Oskar", "Beatrix",
]

_PRODUCT_PREFIXES = [
    "Veri", "Soli", "Chron", "Auro", "Luna", "Zyph", "Nexo", "Prio",
    "Quali", "Trex", "Velo", "Zyra", "Hexa", "Octa", "Deci", "Brev",
    "Clar", "Dura", "Elev", "Flux", "Kiro", "Movi", "Radi", "Talo",
    "Ultr", "Xeno", "Axi", "Bora", "Celo", "Dyna",
]
_PRODUCT_SUFFIXES = [
    "dian", "xon", "rex", "vis", "tek", "rix", "lix", "max", "zen",
    "pro", "air", "ion", "eon", "arc", "gen", "ium", "ora", "ova",
    "ius", "ade", "yte", "ent", "ast", "orn", "ume", "ane", "ite",
    "ode", "ule", "evo",
]
_PRODUCT_MODELS = [
    "X1", "S9", "Pro", "Air", "Elite", "Ultra", "Neo", "Plus", "Lite",
    "Edge", "Core", "Prime", "V2", "Mark IV", "Sport", "Studio",
]
_PRODUCT_TYPES = [
    "headphone", "watch", "camera", "shoe", "game", "glasses", "speaker",
    "keyboard", "chair", "table", "printer", "pen", "guitar", "piano",
    "bike", "drone", "coffee maker", "projector", "bag", "router",
    "laptop", "smartwatch", "earbuds", "tablet", "thermostat",
]

_EVENT_ADJECTIVES = [
    "Great", "Silent", "Crimson", "Iron", "Golden", "Frozen", "Burning",
    "Twilight", "Shadow", "Copper", "Midnight", "Scarlet", "Thunder",
    "Coral", "Granite", "Ivory", "Sapphire", "Amber", "Obsidian", "Azure",
    "Bitter", "Hollow", "Ashen", "Sunken", "Shattered", "Waning",
    "Rusted", "Whispering", "Bleeding", "Forgotten",
]
_EVENT_NOUNS = [
    "Uprising", "Accord", "Exodus", "Conquest", "Rebellion", "Truce",
    "Alliance", "Revolution", "Siege", "Crusade", "Campaign", "Insurrection",
    "Expedition", "Blockade", "Armistice", "Treaty", "Mutiny", "March",
    "Proclamation", "Concordat", "Purge", "Famine", "Collapse", "Schism",
    "Partition", "Pact", "Secession", "Tribunal", "Crisis", "Conflagration",
]
_EVENT_TYPES = [
    "war", "natural disaster", "scientific discovery", "sport event",
    "pandemic", "political crisis", "famine", "revolution", "treaty",
    "expedition",
]

_CITIES = [
    "Prague", "Lisbon", "Vienna", "Budapest", "Warsaw", "Dublin",
    "Helsinki", "Zurich", "Bruges", "Seville", "Florence", "Ljubljana",
    "Tallinn", "Porto", "Krakow", "Bergen", "Ghent", "Reykjavik",
    "Bratislava", "Split", "Tbilisi", "Valletta", "Dubrovnik", "Aarhus",
    "Salzburg", "Brno", "Gdansk", "Riga", "Vilnius", "Maribor",
    "Plovdiv", "Bern", "Lucerne", "Girona", "Siena", "Lecce",
    "Stavanger", "Turku", "Tartu", "Tromso",
]
_COUNTRIES = [
    "Switzerland", "Portugal", "Finland", "Norway", "Ireland", "Austria",
    "Hungary", "Belgium", "Croatia", "Estonia", "Latvia", "Lithuania",
    "Iceland", "Luxembourg", "Malta", "Slovakia", "Slovenia", "Cyprus",
    "Uruguay", "Chile", "Georgia", "Montenegro", "Albania", "Moldova",
    "Armenia", "Paraguay", "Bolivia", "Ecuador", "Bhutan", "Laos",
]


class NonsenseNameGenerator:
    """Generate deterministic fictional business/product/event names.

    Uses varied naming patterns and large combinatorial pools for natural,
    plausible-but-nonexistent entity names. Multiple name structures per
    entity type prevent formulaic patterns that models can trivially detect.
    """

    def __init__(self, seed: int = 1):
        self.seed = seed

    def _gen_business(self, rng: random.Random) -> tuple[str, str, str]:
        """Return (name, type, city) using one of several naming patterns."""
        btype = rng.choice(_BUSINESS_TYPES)
        city = rng.choice(_CITIES)
        pattern = rng.randint(0, 5)
        if pattern == 0:
            # "The [Adj] [Noun]"
            name = f"The {rng.choice(_BUSINESS_ADJECTIVES)} {rng.choice(_BUSINESS_NOUNS)}"
        elif pattern == 1:
            # "[Owner]'s [Noun]"
            name = f"{rng.choice(_BUSINESS_OWNERS)}'s {rng.choice(_BUSINESS_NOUNS)}"
        elif pattern == 2:
            # "[Noun] & [Noun]"
            a, b = rng.sample(_BUSINESS_NOUNS, 2)
            name = f"{a} & {b}"
        elif pattern == 3:
            # "Café/Chez [Owner]" or "Bistro [Adj]"
            prefix = rng.choice(["Café", "Chez", "Bistro", "Maison"])
            name = f"{prefix} {rng.choice(_BUSINESS_OWNERS)}"
        elif pattern == 4:
            # "[Adj] [Noun] House/Lodge/Room"
            suffix = rng.choice(["House", "Lodge", "Room", "Corner", "Hall"])
            name = f"{rng.choice(_BUSINESS_ADJECTIVES)} {rng.choice(_BUSINESS_NOUNS)} {suffix}"
        else:
            # Single evocative word
            name = f"{rng.choice(_BUSINESS_ADJECTIVES)} {rng.choice(_BUSINESS_NOUNS)}"
        return name, btype, city

    def _gen_product(self, rng: random.Random) -> tuple[str, str]:
        """Return (name, type) using one of several naming patterns."""
        ptype = rng.choice(_PRODUCT_TYPES)
        pattern = rng.randint(0, 3)
        if pattern == 0:
            # "[Prefix][Suffix]"
            name = rng.choice(_PRODUCT_PREFIXES) + rng.choice(_PRODUCT_SUFFIXES)
        elif pattern == 1:
            # "[Prefix][Suffix] [Model]"
            name = (rng.choice(_PRODUCT_PREFIXES) + rng.choice(_PRODUCT_SUFFIXES)
                    + " " + rng.choice(_PRODUCT_MODELS))
        elif pattern == 2:
            # "[Prefix]-[Number][Letter]"
            name = f"{rng.choice(_PRODUCT_PREFIXES)}-{rng.randint(100, 999)}{rng.choice('ABCDEFG')}"
        else:
            # "[Prefix][Suffix] by [Owner]"
            name = (rng.choice(_PRODUCT_PREFIXES) + rng.choice(_PRODUCT_SUFFIXES)
                    + " by " + rng.choice(_BUSINESS_OWNERS))
        return name, ptype

    def _gen_event(self, rng: random.Random) -> tuple[str, str, str]:
        """Return (name, type, country) using one of several naming patterns."""
        etype = rng.choice(_EVENT_TYPES)
        country = rng.choice(_COUNTRIES)
        pattern = rng.randint(0, 4)
        if pattern == 0:
            # "The [Adj] [Noun]"
            name = f"The {rng.choice(_EVENT_ADJECTIVES)} {rng.choice(_EVENT_NOUNS)}"
        elif pattern == 1:
            # "The [Noun] of [Year]"
            year = rng.randint(1703, 1962)
            name = f"The {rng.choice(_EVENT_NOUNS)} of {year}"
        elif pattern == 2:
            # "The [Year] [Country] [Noun]"
            year = rng.randint(1703, 1962)
            name = f"The {year} {country} {rng.choice(_EVENT_NOUNS)}"
        elif pattern == 3:
            # "The [Adj] [Noun] of [Country]"
            name = (f"The {rng.choice(_EVENT_ADJECTIVES)} "
                    f"{rng.choice(_EVENT_NOUNS)} of {country}")
        else:
            # "[Country] [Noun]"
            name = f"{country} {rng.choice(_EVENT_NOUNS)}"
        return name, etype, country

    def generate(self, n: int) -> list[dict]:
        rng = random.Random(self.seed)
        seen_names: set[str] = set()
        results: list[dict] = []

        # Split n roughly equally: 40% business, 20% product, 40% event
        n_business = max(1, int(n * 0.4))
        n_product = max(1, int(n * 0.2))
        n_event = n - n_business - n_product

        # Generate businesses (with dedup)
        attempts = 0
        while len(results) < n_business and attempts < n_business * 5:
            attempts += 1
            name, btype, city = self._gen_business(rng)
            if name in seen_names:
                continue
            seen_names.add(name)
            prompt_tmpl = rng.choice(_DESCRIBE_PLACE)
            results.append({
                "name": name,
                "type": btype,
                "place": city,
                "prompt": prompt_tmpl.format(type=btype, place=city, name=name),
            })

        # Generate products (with dedup)
        product_start = len(results)
        attempts = 0
        while len(results) - product_start < n_product and attempts < n_product * 5:
            attempts += 1
            name, ptype = self._gen_product(rng)
            if name in seen_names:
                continue
            seen_names.add(name)
            prompt_tmpl = rng.choice(_DESCRIBE_PRODUCT)
            results.append({
                "name": name,
                "type": ptype,
                "place": "",
                "prompt": prompt_tmpl.format(type=ptype, name=name),
            })

        # Generate events (with dedup)
        event_start = len(results)
        attempts = 0
        while len(results) - event_start < n_event and attempts < n_event * 5:
            attempts += 1
            name, etype, country = self._gen_event(rng)
            if name in seen_names:
                continue
            seen_names.add(name)
            prompt_tmpl = rng.choice(_DESCRIBE_PLACE)
            results.append({
                "name": name,
                "type": etype,
                "place": country,
                "prompt": prompt_tmpl.format(type=etype, place=country, name=name),
            })

        rng.shuffle(results)
        return results[:n]
