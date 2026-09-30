import time

import pytest

from app import sunflower as sf

DESERT_TS = """
export const CHAPTER_ARTEFACT: Record<ChapterName, BeachBountyChapterArtefact> =
  {
    "Salt Awakening": "Salt Dino Egg",
    "Ascension Age": "Otter Pebble",
  };

export const DIGGING_FORMATIONS = {
  ARTEFACT_FOURTEEN: [
    { x: 0, y: 0, name: "Seasonal Artefact" },
    { x: 0, y: 2, name: "Camel Bone" },
  ],
  CLAM_SHELLS: [
    { x: 0, y: 0, name: "Clam Shell" },
    { x: 1, y: -1, name: "Clam Shell" },
  ],
} satisfies Record<string, DiggingFormation>;
"""

CHAPTERS_TS = """
export const CHAPTERS: Record<ChapterName, ChapterDates> = {
  "Salt Awakening": {
    startDate: new Date("2026-05-04T00:00:00.000Z"),
    tasksBegin: new Date("2026-05-11T00:00:00.000Z"), // Visual only
    endDate: new Date("2026-08-03T00:00:00.000Z"),
  },
  "Ascension Age": {
    startDate: new Date("2026-08-03T00:00:00.000Z"),
    endDate: new Date("2026-11-02T00:00:00.000Z"),
  },
};
"""


def test_parse_formations_keeps_offsets():
    f = sf.parse_formations(DESERT_TS)
    assert f["ARTEFACT_FOURTEEN"] == [
        {"x": 0, "y": 0, "item": "Seasonal Artefact"},
        {"x": 0, "y": 2, "item": "Camel Bone"},
    ]
    assert f["CLAM_SHELLS"][1] == {"x": 1, "y": -1, "item": "Clam Shell"}


def test_parse_chapters_maps_artefact():
    ch = sf.parse_chapters(DESERT_TS, CHAPTERS_TS)
    assert [c["artefact"] for c in ch] == ["Salt Dino Egg", "Otter Pebble"]
    assert ch[1]["start"] == "2026-08-03T00:00:00.000Z"


def _farm(grid, **extra):
    farm = {
        "desert": {"digging": {"patterns": ["ARTEFACT_FOURTEEN"], "grid": grid, "extraDigs": 2}},
        "inventory": {"Sand Shovel": "5", "Sand Drill": "1"},
        "collectibles": {},
        "home": {"collectibles": {}},
        "bumpkin": {"equipped": {}},
        "farmHands": {"bumpkins": {}},
    }
    farm.update(extra)
    return {"id": 42, "updatedAt": "1790795023363", "farm": farm}


@pytest.fixture
def fake_farm(monkeypatch):
    holder = {}
    monkeypatch.setattr(sf.client, "farm", lambda land_id: holder["data"])
    return holder


def test_digging_state_today_only(fake_farm):
    now = int(time.time() * 1000)
    yesterday = now - 2 * 86400 * 1000
    fake_farm["data"] = _farm(
        [
            {"x": 1, "y": 2, "dugAt": now, "items": {"Otter Pebble": 1}, "tool": "Sand Shovel"},
            {"x": 5, "y": 5, "dugAt": yesterday, "items": {"Sand": 1}, "tool": "Sand Shovel"},
            [
                {"x": 0, "y": 0, "dugAt": now, "items": {"Crab": 1}, "tool": "Sand Drill"},
                {"x": 1, "y": 0, "dugAt": now, "items": {"Sand": 1}, "tool": "Sand Drill"},
            ],
        ]
    )
    st = sf.digging_state("42")
    assert [(h["x"], h["y"], h["item"]) for h in st["holes"]] == [(1, 2, "Otter Pebble"), (0, 0, "Crab"), (1, 0, "Sand")]
    # el taladro cuenta como una excavación
    assert st["digs"] == {"max": 25, "used": 2, "extra": 2, "left": 25}
    assert st["shovels"] == 5 and st["drills"] == 1
    assert st["budget"] == 5  # 25 excavaciones restantes, pero solo 5 palas
    assert not st["stale"]
    assert st["formations"]["ARTEFACT_FOURTEEN"][0]["item"] == sf.seed.artefact(now)
    assert {"Camel Bone", "Crab", "Sand", sf.seed.artefact(now)} <= set(st["icons"])


def test_digging_state_stale_and_boosts(fake_farm):
    old = int(time.time() * 1000) - 2 * 86400 * 1000
    fake_farm["data"] = _farm(
        [{"x": 1, "y": 2, "dugAt": old, "items": {"Sand": 1}, "tool": "Sand Shovel"}],
        collectibles={"Meerkat": [{"coordinates": {"x": 1, "y": 1}, "readyAt": 0}]},
        bumpkin={"equipped": {"tool": "Bionic Drill"}},
    )
    st = sf.digging_state("42")
    assert st["stale"] and st["holes"] == []
    assert st["digs"]["max"] == 35


def test_ancient_shovel_does_not_spend_shovels(fake_farm):
    fake_farm["data"] = _farm([], bumpkin={"equipped": {"tool": "Ancient Shovel"}})
    assert sf.digging_state("42")["budget"] == 27


def test_unknown_pattern_is_reported(fake_farm, monkeypatch):
    monkeypatch.setattr(sf.seed, "ensure", lambda names: None)
    data = _farm([])
    data["farm"]["desert"]["digging"]["patterns"] = ["NO_EXISTE"]
    fake_farm["data"] = data
    with pytest.raises(sf.SunflowerError) as exc:
        sf.digging_state("42")
    assert exc.value.status == 502
