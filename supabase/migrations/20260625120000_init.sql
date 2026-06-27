-- ============================================================================
-- MGBallpark - Service Package Calculator: Database Schema
-- ----------------------------------------------------------------------------
-- HOW TO USE: Supabase Dashboard -> SQL Editor -> New query -> paste & Run.
-- Safe to re-run (DROP ... CASCADE gives a clean slate each time).
--
-- SEED DATA SOURCE: generated from the company rate sheet (Labor Rates +
-- Asset Rates V2 tabs). base_rate values are internal COSTS in PHP. The client
-- app applies a hidden markup; the admin panel (admin.html) can edit anything.
-- Named individuals, zero-rate rows, and social/bot services were excluded.
-- ============================================================================

DROP TABLE IF EXISTS services CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS settings CASCADE;

-- Global settings. Single row id = 1. Rates stored as FRACTIONS (0.125 = 12.5%).
CREATE TABLE settings (
    id           INT           PRIMARY KEY DEFAULT 1,
    asf_rate     DECIMAL(5,4)  NOT NULL DEFAULT 0.125,
    vat_rate     DECIMAL(5,4)  NOT NULL DEFAULT 0.12,
    usd_php_rate DECIMAL(10,4) NOT NULL DEFAULT 55.89
);

CREATE TABLE categories (
    id          SERIAL PRIMARY KEY,
    name        TEXT   NOT NULL,
    description TEXT,
    sort_order  INT    NOT NULL DEFAULT 0,
    core        TEXT   NOT NULL DEFAULT 'MET'   -- core service: MET | MMARK | M-TECH
);

CREATE TABLE services (
    id             SERIAL PRIMARY KEY,
    category_id    INT     NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name           TEXT    NOT NULL,
    base_rate      DECIMAL(10,2) NOT NULL DEFAULT 0,
    unit           TEXT,
    is_fabrication BOOLEAN NOT NULL DEFAULT false,
    sort_order     INT     NOT NULL DEFAULT 0
);

-- Disable Row Level Security so the public anon key can read AND write
-- (documented choice for this internal/demo tool). Supabase may auto-enable
-- RLS on new tables, so we explicitly turn it OFF here.
ALTER TABLE settings   DISABLE ROW LEVEL SECURITY;
ALTER TABLE categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE services   DISABLE ROW LEVEL SECURITY;

-- Settings seed: ASF 12.5%, VAT 12%, USD->PHP FX 55.89
INSERT INTO settings (id, asf_rate, vat_rate, usd_php_rate) VALUES (1, 0.125, 0.12, 55.89);

-- Categories
INSERT INTO categories (name, description, sort_order) VALUES
  ('Manpower (Crew Day Rates)', 'Internal crew/staff day rates by role (source: Labor Rates)', 1),
  ('Venue & Spaces', 'Venues, halls, studios, arenas & event spaces', 2),
  ('Permits & Safety', 'Permits, medical, fire, police & safety services', 3),
  ('Internet & Network', 'Internet lines, WiFi & network infrastructure', 4),
  ('Power & Electrical', 'Gensets, power distribution & electrical', 5),
  ('Camera & Grip', 'Cameras, lenses, grip, gimbals & camera support', 6),
  ('Lighting', 'Lighting fixtures, consoles & control', 7),
  ('Audio', 'Sound systems, mics, mixers & audio gear', 8),
  ('LED & Display', 'LED walls, screens, projectors & displays', 9),
  ('Truss, Stage & Rigging', 'Trussing, staging, rigging, tents & platforms', 10),
  ('Fabrication & Signage', 'Fabrication, printing, signage & booth build', 11),
  ('Awards & Print Collateral', 'Trophies, medals, certificates & printed collateral', 12),
  ('Transport & Logistics', 'Vehicles, trucking & logistics', 13),
  ('Furniture & Decor', 'Furniture, decor, carpet & ambience', 14),
  ('Special Effects', 'Smoke, laser, CO2, fireworks & special effects', 15),
  ('Merchandise & Apparel', 'Merch, apparel & giveaways', 16),
  ('IT & Computing', 'Computers, servers, capture & IT gear', 17),
  ('Other Equipment', 'Other rate-card items (uncategorized)', 18);

-- Assign categories to core services (rest default to 'MET').
UPDATE categories SET core = 'MMARK'
  WHERE name IN ('Camera & Grip', 'Awards & Print Collateral', 'Merchandise & Apparel');
UPDATE categories SET core = 'M-TECH'
  WHERE name IN ('Internet & Network', 'LED & Display', 'IT & Computing');

-- Manpower (Crew Day Rates) (24)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('Account Manager (Sales)', 2500.00, 'per day', false, 1),
  ('Broadcast Associate (Broadcast)', 1750.00, 'per day', false, 2),
  ('Broadcast Engineer (Broadcast)', 2500.00, 'per day', false, 3),
  ('Broadcast Manager (Broadcast)', 3250.00, 'per day', false, 4),
  ('Campaign Associate (Marketing)', 1750.00, 'per day', false, 5),
  ('Campaign Manager (Marketing)', 2500.00, 'per day', false, 6),
  ('Creative Supervisor (Creative)', 2500.00, 'per day', false, 7),
  ('Driver (GG Company)', 1500.00, 'per day', false, 8),
  ('Graphic Artist (Creative)', 1750.00, 'per day', false, 9),
  ('IT Manager (IT)', 2500.00, 'per day', false, 10),
  ('IT Officer (IT)', 1750.00, 'per day', false, 11),
  ('League Operations Assistant (League Operations)', 1750.00, 'per day', false, 12),
  ('League Operations Officer (League Operations)', 1750.00, 'per day', false, 13),
  ('League Operations Supervisor (League Operations)', 2500.00, 'per day', false, 14),
  ('Logistics Officer (Procurement)', 1500.00, 'per day', false, 15),
  ('Procurement Manager (Procurement)', 2500.00, 'per day', false, 16),
  ('Procurement Officer (Procurement)', 1750.00, 'per day', false, 17),
  ('Product Manager (Product Management)', 3250.00, 'per day', false, 18),
  ('Project Management Associate (Project Management)', 1750.00, 'per day', false, 19),
  ('Project Manager (Project Management)', 2500.00, 'per day', false, 20),
  ('Senior Project Manager (Project Management)', 3250.00, 'per day', false, 21),
  ('Shooter/Photographer (Creative)', 1500.00, 'per day', false, 22),
  ('Talent Manager (Procurement)', 1750.00, 'per day', false, 23),
  ('Video Editor (Creative)', 1750.00, 'per day', false, 24)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Manpower (Crew Day Rates)';

-- Venue & Spaces (14)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('HYPERDECK MINI STUDIO', 1730.00, 'per day', false, 1),
  ('SMALL BOOTH/ROOM (3X3)', 6401.00, 'per day', false, 2),
  ('STAND FOR SMALL-NORMAL LIGHT', 51.90, 'per day', false, 3),
  ('VENUE - BALLROOM / MEETING ROOM', 173000.00, 'per day', false, 4),
  ('VENUE - CONVENTION CENTRE', 570900.00, 'per day', false, 5),
  ('VENUE - FUNCTION HALL', 380600.00, 'per day', false, 6),
  ('VENUE - MALL SPACE', 373680.00, 'per day', false, 7),
  ('VENUE - RESTAURANT/BAR/CAFÉ', 16089.00, 'per day', false, 8),
  ('VENUE - STADIUM / COURT / ARENA', 519000.00, 'per day', false, 9),
  ('VENUE - STUDIO', 29410.00, 'per day', false, 10),
  ('VENUE - UNIVERSITIES', 51900.00, 'per day', false, 11),
  ('VENUE - VILLA', 51900.00, 'per day', false, 12),
  ('VIRTUAL STUDIO (UE)', 113142.00, 'per day', false, 13),
  ('VIRTUAL STUDIO (VMIX)', 61069.00, 'per day', false, 14)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Venue & Spaces';

-- Permits & Safety (4)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('AMBULANCE (ONLY)', 3460.00, 'per day', false, 1),
  ('AMBULANCE AND 1 MEDIC', 4152.00, 'per day', false, 2),
  ('FIRE FIGHTER + PERSONNEL', 13840.00, 'per day', false, 3),
  ('POLICE PERMIT', 173000.00, 'per day', false, 4)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Permits & Safety';

-- Internet & Network (16)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('BACKUP INTERNET 100 MBPS', 103800.00, 'per day', false, 1),
  ('BACKUP INTERNET 200 MBPS', 138400.00, 'per day', false, 2),
  ('BACKUP INTERNET 250 MBPS', 155700.00, 'per day', false, 3),
  ('BACKUP INTERNET 50 MBPS', 69200.00, 'per day', false, 4),
  ('BACKUP INTERNET 500 MBPS', 207600.00, 'per day', false, 5),
  ('INTERNET INSTALLATION', 10380.00, 'per day', false, 6),
  ('LANYARD FULL PRINT', 51.90, 'per day', false, 7),
  ('MAIN INTERNET 100 MBPS', 103800.00, 'per day', false, 8),
  ('MAIN INTERNET 200 MBPS', 138400.00, 'per day', false, 9),
  ('MAIN INTERNET 250 MBPS', 155700.00, 'per day', false, 10),
  ('MAIN INTERNET 50 MBPS', 69200.00, 'per day', false, 11),
  ('MAIN INTERNET 500 MBPS', 207600.00, 'per day', false, 12),
  ('SMART VIDEO HUB/ROUTER 12x12', 3460.00, 'per day', false, 13),
  ('SMART VIDEO HUB/ROUTER 20x20', 5190.00, 'per day', false, 14),
  ('SMART VIDEO HUB/ROUTER 40x40', 6228.00, 'per day', false, 15),
  ('SMART VIDEO HUB/ROUTER 64x64', 8650.00, 'per day', false, 16)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Internet & Network';

-- Power & Electrical (23)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('CABLE RAMP', 519.00, 'per day', false, 1),
  ('GENSET OVERTIME CHARGE 100 KVA', 774.52, 'per day', false, 2),
  ('GENSET OVERTIME CHARGE 150 KVA', 999.08, 'per day', false, 3),
  ('GENSET OVERTIME CHARGE 150 KVA SYNC', 813.10, 'per day', false, 4),
  ('GENSET OVERTIME CHARGE 200 KVA', 1398.70, 'per day', false, 5),
  ('GENSET OVERTIME CHARGE 250 KVA', 1798.34, 'per day', false, 6),
  ('GENSET OVERTIME CHARGE 250 KVA SYNC', 1833.80, 'per day', false, 7),
  ('GENSET OVERTIME CHARGE 40 KVA', 406.10, 'per day', false, 8),
  ('GENSET OVERTIME CHARGE 60 KVA', 523.33, 'per day', false, 9),
  ('GENSET OVERTIME CHARGE 80 KVA', 586.12, 'per day', false, 10),
  ('POWER BANK', 415.20, 'per day', false, 11),
  ('SILENT GENSET 100KVA + TRUCK', 18882.52, 'per day', false, 12),
  ('SILENT GENSET 150KVA + TRUCK', 25748.89, 'per day', false, 13),
  ('SILENT GENSET 150KVA SYNCHRONIZE + TRUCK', 32233.79, 'per day', false, 14),
  ('SILENT GENSET 200KVA + TRUCK', 31089.40, 'per day', false, 15),
  ('SILENT GENSET 250KVA + TRUCK', 37459.86, 'per day', false, 16),
  ('SILENT GENSET 250KVA SYNCHRONIZE + TRUCK', 42418.91, 'per day', false, 17),
  ('SILENT GENSET 40KVA + TRUCK', 10590.19, 'per day', false, 18),
  ('SILENT GENSET 60KVA + TRUCK', 14186.86, 'per day', false, 19),
  ('SILENT GENSET 80KVA + TRUCK', 15585.57, 'per day', false, 20),
  ('STANDING AC 5 PK', 2595.00, 'per day', false, 21),
  ('STANDING ACRYLIC', 346.00, 'per day', false, 22),
  ('STICKER VINYL QUANTAC', 259.50, 'per day', false, 23)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Power & Electrical';

-- Camera & Grip (53)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('BLACKMAGIC FO CONVERTER', 1038.00, 'per day', false, 1),
  ('CAMERA HIGH END', 5190.00, 'per day', false, 2),
  ('CAMERA LOW END', 692.00, 'per day', false, 3),
  ('CAMERA MID END', 2941.00, 'per day', false, 4),
  ('CAMERA MONITOR HIGH END', 1730.00, 'per day', false, 5),
  ('CAMERA MONITOR LOW END', 1038.00, 'per day', false, 6),
  ('CAMERA MONITOR MID END', 1384.00, 'per day', false, 7),
  ('CAMERA VERY HIGH END', 12456.00, 'per day', false, 8),
  ('CANON LENS', 692.00, 'per day', false, 9),
  ('DOLLY TRACK', 5882.00, 'per day', false, 10),
  ('DRY ICE : LEFT & RIGHT, BIANG ES 25 KG', 10380.00, 'per day', false, 11),
  ('E-MOUNT TO EF-MOUNT', 519.00, 'per day', false, 12),
  ('FILTER CPL', 346.00, 'per day', false, 13),
  ('FILTER ND SET', 415.20, 'per day', false, 14),
  ('JIMMY JIB', 1211.00, 'per day', false, 15),
  ('MACRO LENS', 5190.00, 'per day', false, 16),
  ('MAGNUM DOLLY FULL SET', 12110.00, 'per day', false, 17),
  ('MARSHALL CAM', 2076.00, 'per day', false, 18),
  ('MONOPOD 2W FLUIT TILT HEAD', 173.00, 'per day', false, 19),
  ('PACKAGE HANDHELD GIMBAL SUPPORT SYSTEM', 8650.00, 'per day', false, 20),
  ('PACKAGE STABILIZER WITH READY RIG', 10380.00, 'per day', false, 21),
  ('PHOTO CAMERA HIGH END', 2249.00, 'per day', false, 22),
  ('PHOTO CAMERA LOW END', 1297.50, 'per day', false, 23),
  ('PHOTO CAMERA MID END', 1557.00, 'per day', false, 24),
  ('PHOTO CAMERA MID-HIGH END', 1903.00, 'per day', false, 25),
  ('PORTA JIB', 4844.00, 'per day', false, 26),
  ('SIGMA LENS', 778.50, 'per day', false, 27),
  ('SIGNAGE TRIPOD A1', 121.10, 'per day', false, 28),
  ('SIGNAGE TRIPOD A2', 121.10, 'per day', false, 29),
  ('SIGNAGE TRIPOD A3', 60.55, 'per day', false, 30),
  ('SIGNAGE TRIPOD A4', 29.41, 'per day', false, 31),
  ('SLIDER POD', 1038.00, 'per day', false, 32),
  ('SLIDER SYSTEM LOW END', 1038.00, 'per day', false, 33),
  ('SLIDER SYSTEM MID END', 2422.00, 'per day', false, 34),
  ('SONY LENS', 1211.00, 'per day', false, 35),
  ('SPOT LIGHT MOUNT SET', 692.00, 'per day', false, 36),
  ('STEADICAM JUNIOR', 6574.00, 'per day', false, 37),
  ('STEADICAM SENIOR', 6574.00, 'per day', false, 38),
  ('STEP UP RING SET', 346.00, 'per day', false, 39),
  ('TELE LENS UP TO 40X', 11418.00, 'per day', false, 40),
  ('TELE LENS UP TO 70X', 20760.00, 'per day', false, 41),
  ('TRACE FRAME + DIFFUSE FILTER', 519.00, 'per day', false, 42),
  ('TRIPOD HEAVY DUTY', 346.00, 'per day', false, 43),
  ('TRIPOD LIGHT DUTY', 2595.00, 'per day', false, 44),
  ('TRIPOD MEDIUM DUTY', 865.00, 'per day', false, 45),
  ('TRIPOD SPEAKER', 346.00, 'per day', false, 46),
  ('VIDEO CAMERA HIGH END', 44980.00, 'per day', false, 47),
  ('VIDEO CAMERA LOW-MID END', 2422.00, 'per day', false, 48),
  ('VIDEO CAMERA MID END', 2595.00, 'per day', false, 49),
  ('VIDEO CAMERA MID-HIGH END', 9688.00, 'per day', false, 50),
  ('WIDE LENS', 2941.00, 'per day', false, 51),
  ('WIDE LENS (SONY)', 1211.00, 'per day', false, 52),
  ('WIRELESS VIDEO CVW', 3460.00, 'per day', false, 53)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Camera & Grip';

-- Lighting (51)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('APUTURE LS 120 ONE-COLOR', 865.00, 'per day', false, 1),
  ('APUTURE LS 1200 ONE-COLOR', 2422.00, 'per day', false, 2),
  ('APUTURE LS 20 BI-COLOR', 346.00, 'per day', false, 3),
  ('APUTURE LS 300 BI-COLOR', 1384.00, 'per day', false, 4),
  ('APUTURE LS 300 ONE-COLOR', 1211.00, 'per day', false, 5),
  ('APUTURE LS 60 BI-COLOR', 692.00, 'per day', false, 6),
  ('APUTURE LS 600 BI-COLOR', 1903.00, 'per day', false, 7),
  ('APUTURE LS 600 ONE-COLOR', 1903.00, 'per day', false, 8),
  ('APUTURE LS 600 RGB', 2595.00, 'per day', false, 9),
  ('Avolite Tiger Touch II', 5190.00, 'per day', false, 10),
  ('BEAM LIGHT', 1903.00, 'per day', false, 11),
  ('BEE-EYE / MOVINGWASH', 2595.00, 'per day', false, 12),
  ('BSW MOVING HEAD LIGHT', 2595.00, 'per day', false, 13),
  ('CUTTING BENTUK, LIGHTED, HPL, CAT DUCO,', 4498.00, 'per day', false, 14),
  ('CUTTING BENTUK, STICKER, LOGO LIGHTED, AMBIENCE LIGHTED', 3114.00, 'per day', false, 15),
  ('CUTTING BENTUK, STICKER, LOGO LIGHTED, AMBIENCE LIGHTED, AKRILIK 5MM', 5190.00, 'per day', false, 16),
  ('FLASH LIGHT', 173.00, 'per day', false, 17),
  ('FLAT KOTAK, TIDAK LIGHTED, MELAMINTO, CAT TEMBOK,', 5190.00, 'per day', false, 18),
  ('FLEXIBLE LED LIGHT 40x60 + SOFTBOX', 865.00, 'per day', false, 19),
  ('FOLLOW SPOT', 3460.00, 'per day', false, 20),
  ('FRESNEL LED 300', 1211.00, 'per day', false, 21),
  ('HIGHLIGHT VIDEO MD', 3979.00, 'per day', false, 22),
  ('HIGHLIGHTS VIDEO', 6055.00, 'per day', false, 23),
  ('KOTAK TIDAK BENTUK, FLEXY, LOGO MULTIPLEK, TIDAK LIGHTED', 2249.00, 'per day', false, 24),
  ('LIGHTING DIRECTOR INT - TRAVEL OTHERS', 1470.50, 'per day', false, 25),
  ('LIGHTING DIRECTOR INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 26),
  ('LIGHTING DIRECTOR INT - WEEKDAYS', 692.00, 'per day', false, 27),
  ('LIGHTING DIRECTOR INT - WEEKEND', 605.50, 'per day', false, 28),
  ('MA LIGHTING GRANDMA 2 / 3', 17300.00, 'per day', false, 29),
  ('Matrix Wash LED P5', 1384.00, 'per day', false, 30),
  ('MINIBRUTE LED', 1384.00, 'per day', false, 31),
  ('Moving Wash LED Glamour 1930', 2422.00, 'per day', false, 32),
  ('ORBITER LED LIGHT', 5190.00, 'per day', false, 33),
  ('OUTDOOR FLASH LIGHT + TRIGGER', 605.50, 'per day', false, 34),
  ('PAR 1203 LED RGBW', 951.50, 'per day', false, 35),
  ('RGB LED PANEL 300W MID END', 1730.00, 'per day', false, 36),
  ('RGB LED PANEL 600W HIGH END', 3460.00, 'per day', false, 37),
  ('RGB LED PANEL 600W MID END', 2595.00, 'per day', false, 38),
  ('SIMPLE HIGHLIGHT VIDEO MD', 2076.00, 'per day', false, 39),
  ('SOFTBOX', 346.00, 'per day', false, 40),
  ('SOFTBOX KIT 12X12 FEET', 2595.00, 'per day', false, 41),
  ('SOFTBOX PARABOLIC / STRIP', 173.00, 'per day', false, 42),
  ('STICKER BACKLIGHT', 346.00, 'per day', false, 43),
  ('Strobe LED ST5000', 2076.00, 'per day', false, 44),
  ('TUBE LIGHT HIGH END (8)', 8650.00, 'per day', false, 45),
  ('TUBE LIGHT LOW END (1)', 432.50, 'per day', false, 46),
  ('TUBE LIGHT MID END (4)', 1730.00, 'per day', false, 47),
  ('TUBE LIGHT MID END (8)', 3114.00, 'per day', false, 48),
  ('VARIOUS LIGHT DOME', 346.00, 'per day', false, 49),
  ('WALL-WASHER LED', 1384.00, 'per day', false, 50),
  ('WallWasher 1815 5in1', 1384.00, 'per day', false, 51)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Lighting';

-- Audio (57)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('ATTENDANCE MICRO INFLUENCER 10K - 49K', 6920.00, 'per day', false, 1),
  ('ATTENDANCE MICRO INFLUENCER 50K - 99K', 10380.00, 'per day', false, 2),
  ('Audicenter KLA 218', 10380.00, 'per day', false, 3),
  ('BEHRINGER P1 IEM (MONO)', 865.00, 'per day', false, 4),
  ('BEHRINGER P1 IEM (STEREO)', 1038.00, 'per day', false, 5),
  ('BEHRINGER P16i', 1730.00, 'per day', false, 6),
  ('BEHRINGER P16M', 1557.00, 'per day', false, 7),
  ('Behringer WING 48', 6920.00, 'per day', false, 8),
  ('BOOM MIC SET', 605.50, 'per day', false, 9),
  ('Hardwell Mini Mixer', 1038.00, 'per day', false, 10),
  ('HK Audio Collumn Speaker', 5190.00, 'per day', false, 11),
  ('IG FEED MICRO INFLUENCER 10K - 49K', 4325.00, 'per day', false, 12),
  ('IG FEED MICRO INFLUENCER 50K - 99K', 6055.00, 'per day', false, 13),
  ('IG REELS MICRO INFLUENCER 10K - 49K', 5190.00, 'per day', false, 14),
  ('IG REELS MICRO INFLUENCER 50K - 99K', 8650.00, 'per day', false, 15),
  ('IG STORY MICRO INFLUENCER 10K - 49K', 1730.00, 'per day', false, 16),
  ('IG STORY MICRO INFLUENCER 50K - 99K', 2595.00, 'per day', false, 17),
  ('Mackie TH12', 1384.00, 'per day', false, 18),
  ('Mackie TH15', 1557.00, 'per day', false, 19),
  ('MIdas DL32', 3460.00, 'per day', false, 20),
  ('Midas M32', 5190.00, 'per day', false, 21),
  ('Midas M32r', 4152.00, 'per day', false, 22),
  ('MUSIC & SOUND DIRECTOR INT - TRAVEL OTHERS', 1470.50, 'per day', false, 23),
  ('MUSIC & SOUND DIRECTOR INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 24),
  ('MUSIC & SOUND DIRECTOR INT - WEEKDAYS', 692.00, 'per day', false, 25),
  ('MUSIC & SOUND DIRECTOR INT - WEEKEND', 605.50, 'per day', false, 26),
  ('Nexo Geos S1210', 3460.00, 'per day', false, 27),
  ('Nexo Geos S1230', 3460.00, 'per day', false, 28),
  ('Nexo LS18', 5190.00, 'per day', false, 29),
  ('Nexo NXAMP4x4', 8650.00, 'per day', false, 30),
  ('Nexo P515', 3460.00, 'per day', false, 31),
  ('Nexo Ps8', 2768.00, 'per day', false, 32),
  ('Nexo RS18', 8650.00, 'per day', false, 33),
  ('Proel WD12A', 2595.00, 'per day', false, 34),
  ('SENNHEISER EW100 IEM G3/G4', 1730.00, 'per day', false, 35),
  ('SHURE BETA52', 432.50, 'per day', false, 36),
  ('SHURE BETA91', 865.00, 'per day', false, 37),
  ('SHURE PG81', 519.00, 'per day', false, 38),
  ('SHURE SLX - SM58', 865.00, 'per day', false, 39),
  ('SHURE SM57', 346.00, 'per day', false, 40),
  ('SHURE SM58', 346.00, 'per day', false, 41),
  ('SNAKE CABLE 12CH 15M', 1730.00, 'per day', false, 42),
  ('SNAKE CABLE 16CH 15M', 2422.00, 'per day', false, 43),
  ('SNAKE CABLE 8CH 15M', 1038.00, 'per day', false, 44),
  ('STAND MICROPHONE LONG', 346.00, 'per day', false, 45),
  ('STAND MICROPHONE SHORT', 432.50, 'per day', false, 46),
  ('Yamaha CL3', 13840.00, 'per day', false, 47),
  ('Yamaha DBR12', 1730.00, 'per day', false, 48),
  ('Yamaha DBR15', 2076.00, 'per day', false, 49),
  ('Yamaha DSR118', 2076.00, 'per day', false, 50),
  ('Yamaha DSR215', 2768.00, 'per day', false, 51),
  ('Yamaha HS Series', 1557.00, 'per day', false, 52),
  ('Yamaha MGP16CX', 1384.00, 'per day', false, 53),
  ('Yamaha MGP32CX', 1730.00, 'per day', false, 54),
  ('Yamaha QLS', 10380.00, 'per day', false, 55),
  ('Yamaha RIO16', 3460.00, 'per day', false, 56),
  ('Yamaha RIO32', 5190.00, 'per day', false, 57)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Audio';

-- LED & Display (14)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('Caiyida P2.6 Indor', 5190.00, 'per day', false, 1),
  ('Caiyida P3.9 Floor', 5190.00, 'per day', false, 2),
  ('Caiyida P3.9 Indor', 3460.00, 'per day', false, 3),
  ('Caiyida P3.9 Outdoor', 3460.00, 'per day', false, 4),
  ('DIRECTOR MONITOR MID END', 865.00, 'per day', false, 5),
  ('LED SCREEN (AFTER DAY 1)', 865.00, 'per day', false, 6),
  ('LED SCREEN (DAY 1)', 1730.00, 'per day', false, 7),
  ('LED SCREEN (REHEARSAL)', 865.00, 'per day', false, 8),
  ('Leyard P3.9 Indor', 3460.00, 'per day', false, 9),
  ('MONITOR TRUE COLOR', 1730.00, 'per day', false, 10),
  ('SCREEN 20X20 + STAND', 865.00, 'per day', false, 11),
  ('Unilumin P2.9 Indoor', 5190.00, 'per day', false, 12),
  ('Unilumin P3.9 Indor', 4325.00, 'per day', false, 13),
  ('Unilumin P3.9 Outdoor', 5190.00, 'per day', false, 14)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'LED & Display';

-- Truss, Stage & Rigging (15)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('ATTENDANCE MACRO INFLUENCER 100K - 199K', 17300.00, 'per day', false, 1),
  ('ATTENDANCE MACRO INFLUENCER 200K - 299K', 24220.00, 'per day', false, 2),
  ('ATTENDANCE MACRO INFLUENCER 300K - 499K', 34600.00, 'per day', false, 3),
  ('ATTENDANCE MACRO INFLUENCER 500K - 999K', 103800.00, 'per day', false, 4),
  ('ATTENDANCE MEGA INFLUENCER 1M+', 173000.00, 'per day', false, 5),
  ('ATTENDANCE NANO INFLUENCER 1 - 9K', 3460.00, 'per day', false, 6),
  ('BARRICADES', 259.50, 'per day', false, 7),
  ('EPIC STAGE >20M IN WIDTH', 76120.00, 'per day', false, 8),
  ('LARGE STAGE >15M IN WIDTH', 65740.00, 'per day', false, 9),
  ('MEDIUM STAGE (5V5) >15M IN WIDTH', 32697.00, 'per day', false, 10),
  ('MEDIUM STAGE (BATTLEGROUND)', 38925.00, 'per day', false, 11),
  ('SARNAFIL 3X3', 2768.00, 'per day', false, 12),
  ('SARNAFIL 5X5', 4152.00, 'per day', false, 13),
  ('SIMPLE STAGE (5V5) <15M IN WIDTH', 25431.00, 'per day', false, 14),
  ('SIMPLE STAGE (BATTLEGROUND)', 32697.00, 'per day', false, 15)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Truss, Stage & Rigging';

-- Fabrication & Signage (29)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('BALON TEPUK 1 WARNA', 20.76, 'per day', true, 1),
  ('BALON TEPUK FULL PRINT', 31.14, 'per day', true, 2),
  ('BANNER FLEXY JERMAN', 380.60, 'per day', true, 3),
  ('BANNER FLEXY KORCIN (UMBUL-UMBUL)', 173.00, 'per day', true, 4),
  ('BANNER ROLL UP 60X160cm', 761.20, 'per day', true, 5),
  ('BANNER ROLL UP 80X200cm', 865.00, 'per day', true, 6),
  ('BANNER ROLL UP 85X200cm', 934.20, 'per day', true, 7),
  ('CUTTING BENTUK', 1384.00, 'per day', true, 8),
  ('FLEXY BENTUK BOLONG-BOLONG', 4498.00, 'per day', true, 9),
  ('FLEXY KORCIN', 1730.00, 'per day', true, 10),
  ('FLEXY KOREA', 2422.00, 'per day', true, 11),
  ('HAND BANNER', 8650.00, 'per day', true, 12),
  ('KEYCHAIN ACRYLIC', 86.50, 'per day', true, 13),
  ('LARGE BOOTH/ROOM (5X5)++', 15570.00, 'per day', true, 14),
  ('LOGO 2D', 5363.00, 'per day', true, 15),
  ('LOGO 3D', 15224.00, 'per day', true, 16),
  ('MEDALI ACRYLIC', 449.80, 'per day', true, 17),
  ('MEDIUM BOOTH/ROOM (5X5)', 11418.00, 'per day', true, 18),
  ('MELAMINTO', 1557.00, 'per day', true, 19),
  ('PLAKAT ACRYLIC', 2595.00, 'per day', true, 20),
  ('SIMPLE INSTALATION (BACKDROP + LEVEL)', 5017.00, 'per day', true, 21),
  ('SPANDUK', 86.50, 'per day', true, 22),
  ('SPIDER BACKDROP', 12110.00, 'per day', true, 23),
  ('STICKER CROMO', 6.92, 'per day', true, 24),
  ('STICKER RITRAMA BLOCKOUT', 328.70, 'per day', true, 25),
  ('STICKER VINYL CHINA', 242.20, 'per day', true, 26),
  ('WARNA HITAM/CUSTOM WARNA', 1384.00, 'per day', true, 27),
  ('X BANNER 60X160CM', 259.50, 'per day', true, 28),
  ('Y BANNER 60X160CM', 276.80, 'per day', true, 29)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Fabrication & Signage';

-- Awards & Print Collateral (15)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('AGENDA / NOTEBOOK', 173.00, 'per day', false, 1),
  ('DETAILED TROPHY DESIGN', 12629.00, 'per day', false, 2),
  ('FLAYER A5', 2076.00, 'per day', false, 3),
  ('HOST CUE CARD', 17.30, 'per day', false, 4),
  ('MEDALI KUNINGAN', 622.80, 'per day', false, 5),
  ('MOCKUP / GIANT CHECK', 622.80, 'per day', false, 6),
  ('NAME TAG', 31.14, 'per day', false, 7),
  ('NAME TAG (PVC)', 51.90, 'per day', false, 8),
  ('NAME TAG ART CARTOON', 20.76, 'per day', false, 9),
  ('PLAKAT RESIN', 2768.00, 'per day', false, 10),
  ('POSTER', 86.50, 'per day', false, 11),
  ('SERTIFIKAT', 86.50, 'per day', false, 12),
  ('SIMPLE TROPHY DESIGN', 4325.00, 'per day', false, 13),
  ('TROPHY RESIN', 12110.00, 'per day', false, 14),
  ('TROPHY TIMAH', 17300.00, 'per day', false, 15)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Awards & Print Collateral';

-- Transport & Logistics (13)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('LOGISTIC MANAGER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 1),
  ('LOGISTIC MANAGER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 2),
  ('LOGISTIC MANAGER INT - WEEKDAYS', 692.00, 'per day', false, 3),
  ('LOGISTIC MANAGER INT - WEEKEND', 605.50, 'per day', false, 4),
  ('LOGISTIC OFFICER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 5),
  ('LOGISTIC OFFICER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 6),
  ('LOGISTIC OFFICER INT - WEEKDAYS', 692.00, 'per day', false, 7),
  ('LOGISTIC OFFICER INT - WEEKEND', 605.50, 'per day', false, 8),
  ('TEASER/TRAILER', 12110.00, 'per day', false, 9),
  ('TRAILER VIDEO', 15224.00, 'per day', false, 10),
  ('TRAILER VIDEO (MOTION + 3D) 60 SECOND', 30448.00, 'per day', false, 11),
  ('TRAILER VIDEO + VO', 24912.00, 'per day', false, 12),
  ('TRUCKING LOGISTIC / EQUIPMENT', 17300.00, 'per day', false, 13)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Transport & Logistics';

-- Furniture & Decor (22)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('6-TRACK PORTABLE HANDY RECORDER', 692.00, 'per day', false, 1),
  ('AIRPORT ASSISTANT (FAST TRACK)', 2595.00, 'per day', false, 2),
  ('BANTAL', 224.90, 'per day', false, 3),
  ('BARSTOOL', 519.00, 'per day', false, 4),
  ('BLACK CURTAIN', 519.00, 'per day', false, 5),
  ('CASTER/PANELIST TABLE', 11245.00, 'per day', false, 6),
  ('CHAIR COVER & SKIRTING', 69.20, 'per day', false, 7),
  ('CHILLER', 1730.00, 'per day', false, 8),
  ('COFFEE TABLE', 865.00, 'per day', false, 9),
  ('FOLDING TABLE', 173.00, 'per day', false, 10),
  ('FUTURE CHAIR (ONLY)', 34.60, 'per day', false, 11),
  ('GAMING CHAIR', 1903.00, 'per day', false, 12),
  ('KARPET', 2768.00, 'per day', false, 13),
  ('KARPET DILEM DARI BAWAH', 259.50, 'per day', false, 14),
  ('PARTISI', 1384.00, 'per day', false, 15),
  ('QUEUE LINE', 519.00, 'per day', false, 16),
  ('SOFA SINGLE', 1211.00, 'per day', false, 17),
  ('SOFA THREE SEATER', 2595.00, 'per day', false, 18),
  ('SOFA TWO SEATER', 1730.00, 'per day', false, 19),
  ('TABLE (ONLY)', 346.00, 'per day', false, 20),
  ('TABLE + PARASOL', 5190.00, 'per day', false, 21),
  ('TABLE COVER & SKIRTING', 519.00, 'per day', false, 22)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Furniture & Decor';

-- Special Effects (10)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('FIREWORKS / NAPALM (3MIN)', 138400.00, 'per day', false, 1),
  ('FIREWORKS / NAPALM (5MIN)', 259500.00, 'per day', false, 2),
  ('HAZER BIG', 2422.00, 'per day', false, 3),
  ('INFOGRAPHIC/TOURNAMENT FORMAT VIDEO', 25431.00, 'per day', false, 4),
  ('LASER SYSTEM GREEN 10watt', 27680.00, 'per day', false, 5),
  ('LASER SYSTEM GREEN 15watt', 44980.00, 'per day', false, 6),
  ('SMOKE', 3460.00, 'per day', false, 7),
  ('SMOKE GUN', 2076.00, 'per day', false, 8),
  ('SPECIAL EFFECT CO2', 4671.00, 'per day', false, 9),
  ('SPECIAL EFFECT CONVETY', 4671.00, 'per day', false, 10)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Special Effects';

-- Merchandise & Apparel (34)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('BANDANA', 155.70, 'per day', false, 1),
  ('BASEBALL HAT', 155.70, 'per day', false, 2),
  ('DRINK WARE', 242.20, 'per day', false, 3),
  ('E-MONEY', 242.20, 'per day', false, 4),
  ('FLASHDISK', 269.88, 'per day', false, 5),
  ('GOODIE BAG DRIL', 242.20, 'per day', false, 6),
  ('GOODIE BAG KANVAS', 207.60, 'per day', false, 7),
  ('GOODIE BAG SPUNDBOND', 69.20, 'per day', false, 8),
  ('HARDBOX', 622.80, 'per day', false, 9),
  ('HEADBAND', 155.70, 'per day', false, 10),
  ('JACKET BOMBER', 968.80, 'per day', false, 11),
  ('JACKET HOODIE', 865.00, 'per day', false, 12),
  ('JERSEY/UNIFORM', 415.20, 'per day', false, 13),
  ('KEYCHAIN KUNINGAN', 155.70, 'per day', false, 14),
  ('KEYCHAIN STAINLESS', 103.80, 'per day', false, 15),
  ('KIPAS', 24.22, 'per day', false, 16),
  ('MERCHANDISE DESIGN (JACKET)', 3114.00, 'per day', false, 17),
  ('MERCHANDISE DESIGN (JERSEY)', 2595.00, 'per day', false, 18),
  ('MERCHANDISE DESIGN (TSHIRT)', 1903.00, 'per day', false, 19),
  ('MISTY FAN', 1211.00, 'per day', false, 20),
  ('MUG', 173.00, 'per day', false, 21),
  ('PATCH BORDIR JAHIT', 58.82, 'per day', false, 22),
  ('PATCH BORDIR PRES', 65.74, 'per day', false, 23),
  ('PAYUNG', 124.56, 'per day', false, 24),
  ('PEN', 62.28, 'per day', false, 25),
  ('POLO SHIRT', 311.40, 'per day', false, 26),
  ('POUCH', 96.88, 'per day', false, 27),
  ('SANDBAG', 17.30, 'per day', false, 28),
  ('SLING BAG', 311.40, 'per day', false, 29),
  ('SNAPBACK', 242.20, 'per day', false, 30),
  ('T-SHIRT COMBED 24S', 269.88, 'per day', false, 31),
  ('T-SHIRT COMBED 30S', 259.50, 'per day', false, 32),
  ('T-SHIRT NSA', 190.30, 'per day', false, 33),
  ('T-SHIRT SUPPIMA', 311.40, 'per day', false, 34)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Merchandise & Apparel';

-- IT & Computing (22)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('ADDITIONAL AREA/SCENE (VMIX)', 19376.00, 'per day', false, 1),
  ('GAME OBSERVER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 2),
  ('GAME OBSERVER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 3),
  ('GAME OBSERVER INT - WEEKDAYS', 692.00, 'per day', false, 4),
  ('GAME OBSERVER INT - WEEKEND', 605.50, 'per day', false, 5),
  ('HDD EXTERNAL 1TB', 3460.00, 'per day', false, 6),
  ('HDD EXTERNAL 2TB', 5190.00, 'per day', false, 7),
  ('HDD EXTERNAL 4TB', 6920.00, 'per day', false, 8),
  ('LAPTOP CABLE', 173.00, 'per day', false, 9),
  ('PC ENCODER', 5190.00, 'per day', false, 10),
  ('PC MEDIA MANAGER', 2768.00, 'per day', false, 11),
  ('PC OBSERVER', 4152.00, 'per day', false, 12),
  ('PC RECORD', 4152.00, 'per day', false, 13),
  ('PC STATSMAN', 2768.00, 'per day', false, 14),
  ('PC VMIX', 5190.00, 'per day', false, 15),
  ('SWITCHER / CONSOLE LED (AFTER DAY 1)', 20760.00, 'per day', false, 16),
  ('SWITCHER / CONSOLE LED (DAY 1)', 51900.00, 'per day', false, 17),
  ('SWITCHER / CONSOLE LED (REHEARSAL)', 10380.00, 'per day', false, 18),
  ('VMIX OPERATOR INT - TRAVEL OTHERS', 1470.50, 'per day', false, 19),
  ('VMIX OPERATOR INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 20),
  ('VMIX OPERATOR INT - WEEKDAYS', 692.00, 'per day', false, 21),
  ('VMIX OPERATOR INT - WEEKEND', 605.50, 'per day', false, 22)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'IT & Computing';

-- Other Equipment (286)
INSERT INTO services (category_id, name, base_rate, unit, is_fabrication, sort_order)
SELECT c.id, v.name, v.base_rate, v.unit, v.is_fab, v.so
FROM categories c, (VALUES
  ('2D BROADCAST ASSETS (PACKAGE A) UP TO 15 ITEMS', 20241.00, 'per day', false, 1),
  ('2D BROADCAST ASSETS (PACKAGE B) 15-30 ITEMS', 30448.00, 'per day', false, 2),
  ('2D BROADCAST ASSETS (PACKAGE C) UP TO 50 ITEMS', 50170.00, 'per day', false, 3),
  ('2D BROADCAST ASSETS (PACKAGE D) 50 - 100 ITEMS', 81310.00, 'per day', false, 4),
  ('2D OBB', 9515.00, 'per day', false, 5),
  ('2D STINGER', 3287.00, 'per day', false, 6),
  ('2D TEAM INTRO - MAX 16 TEAM', 56225.00, 'per day', false, 7),
  ('2D TEAM INTRO - MAX 24 TEAM', 65740.00, 'per day', false, 8),
  ('2D TEAM INTRO - MAX 8 TEAM', 45845.00, 'per day', false, 9),
  ('3D OBB', 14532.00, 'per day', false, 10),
  ('3D OBB (HIGH DETAIL)', 25950.00, 'per day', false, 11),
  ('3D OPENING VIDEO (INC. STORYBOARD)', 124560.00, 'per day', false, 12),
  ('3D STINGER', 5363.00, 'per day', false, 13),
  ('3D TEAM INTRO (MAX DUR: 1MIN)', 89960.00, 'per day', false, 14),
  ('ACTION CAM', 1038.00, 'per day', false, 15),
  ('ADDITIONAL AREA/ SPONSOR TREATMENT', 29064.00, 'per day', false, 16),
  ('AERIAL/DRONE HIGH END', 12110.00, 'per day', false, 17),
  ('AERIAL/DRONE LOW END', 2768.00, 'per day', false, 18),
  ('AERIAL/DRONE MID END', 5190.00, 'per day', false, 19),
  ('AFTER MOVIE', 17300.00, 'per day', false, 20),
  ('AKG C1000', 519.00, 'per day', false, 21),
  ('AKG C411', 605.50, 'per day', false, 22),
  ('AKG C450', 519.00, 'per day', false, 23),
  ('AKG D112', 432.50, 'per day', false, 24),
  ('AKG D40', 432.50, 'per day', false, 25),
  ('ANTENNA DISTRIBUTOR', 2076.00, 'per day', false, 26),
  ('ANTENNA SHARKFIN', 2076.00, 'per day', false, 27),
  ('APPLE BOX LOW QUALITY', 173.00, 'per day', false, 28),
  ('APPLE BOX MID QUALITY', 346.00, 'per day', false, 29),
  ('ASSISTANT PRODUCER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 30),
  ('ASSISTANT PRODUCER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 31),
  ('ASSISTANT PRODUCER INT - WEEKDAYS', 692.00, 'per day', false, 32),
  ('ASSISTANT PRODUCER INT - WEEKEND', 605.50, 'per day', false, 33),
  ('ATEM 1M/E PANEL', 3460.00, 'per day', false, 34),
  ('ATEM 2M/E CONSTELLATION HD', 6574.00, 'per day', false, 35),
  ('ATEM 2M/E PANEL', 5882.00, 'per day', false, 36),
  ('ATEM 4M/E BROADCAST', 8650.00, 'per day', false, 37),
  ('ATEM 4M/E CONSTELLATION 8K', 13840.00, 'per day', false, 38),
  ('ATH MB1', 346.00, 'per day', false, 39),
  ('ATH PRO35', 605.50, 'per day', false, 40),
  ('ATH PRO45', 346.00, 'per day', false, 41),
  ('ATH PRO63', 346.00, 'per day', false, 42),
  ('BAN & PICK RECAP', 72660.00, 'per day', false, 43),
  ('BIRTHDAY CAKE', 1038.00, 'per day', false, 44),
  ('BLACK FLAG KIT', 346.00, 'per day', false, 45),
  ('BLACK FLOPPY 4X4 FEET', 173.00, 'per day', false, 46),
  ('BLACK PRO-MIST SET', 865.00, 'per day', false, 47),
  ('BROADCAST CREW INT - TRAVEL OTHERS', 1470.50, 'per day', false, 48),
  ('BROADCAST CREW INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 49),
  ('BROADCAST CREW INT - WEEKDAYS', 692.00, 'per day', false, 50),
  ('BROADCAST CREW INT - WEEKEND', 605.50, 'per day', false, 51),
  ('BUFFET', 432.50, 'per day', false, 52),
  ('BUS / HIACE / RENT CAR', 5882.00, 'per day', false, 53),
  ('BUSINESS DEVELOPMENT INT - TRAVEL OTHERS', 1470.50, 'per day', false, 54),
  ('BUSINESS DEVELOPMENT INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 55),
  ('BUSINESS DEVELOPMENT INT - WEEKDAYS', 692.00, 'per day', false, 56),
  ('BUSINESS DEVELOPMENT INT - WEEKEND', 605.50, 'per day', false, 57),
  ('BUTTERFLY FRAME KIT 12X12 FEET', 1557.00, 'per day', false, 58),
  ('BUTTERFLY FRAME KIT 20X20 FEET', 2249.00, 'per day', false, 59),
  ('BUTTERFLY FRAME KIT 6X6 FEET', 865.00, 'per day', false, 60),
  ('BUTTERFLY FRAME KIT 8X8 FEET', 1211.00, 'per day', false, 61),
  ('CABLE ROLL', 121.10, 'per day', false, 62),
  ('CHAIN HOIST 1TON 10 METER', 865.00, 'per day', false, 63),
  ('COMPACT PRIME SERIES PACKAGE (5)', 4325.00, 'per day', false, 64),
  ('CONVERTER PACKAGE UP TO 10', 1730.00, 'per day', false, 65),
  ('CONVERTER PACKAGE UP TO 20', 3460.00, 'per day', false, 66),
  ('CONVERTER PACKAGE UP TO 30', 5190.00, 'per day', false, 67),
  ('CONVERTER PACKAGE UP TO 50', 8650.00, 'per day', false, 68),
  ('COOL BOX', 173.00, 'per day', false, 69),
  ('CREDIT TITLE', 5017.00, 'per day', false, 70),
  ('CUSTOM COUNTDOWN VIDEO', 12715.50, 'per day', false, 71),
  ('CUT DOWN VERSION OPENING VIDEO', 5190.00, 'per day', false, 72),
  ('DESIGNER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 73),
  ('DESIGNER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 74),
  ('DESIGNER INT - WEEKDAYS', 692.00, 'per day', false, 75),
  ('DESIGNER INT - WEEKEND', 605.50, 'per day', false, 76),
  ('DETAILED BRANDING', 25431.00, 'per day', false, 77),
  ('DIGITAL COMMERCIAL', 51900.00, 'per day', false, 78),
  ('DIRECTOR SEAT', 103.80, 'per day', false, 79),
  ('DJ CONTROLLER', 1211.00, 'per day', false, 80),
  ('DYNAMIC 3D STINGER', 16089.00, 'per day', false, 81),
  ('EXTENSION PIPE SEAMLESS', 259.50, 'per day', false, 82),
  ('EXTENSION STAND HEAVY DUTY', 346.00, 'per day', false, 83),
  ('EXTRA OVERLENGHT 16 AMP', 34.60, 'per day', false, 84),
  ('EXTRA OVERLENGHT 32 AMP', 69.20, 'per day', false, 85),
  ('EXTRA OVERLENGHT 64 AMP', 121.10, 'per day', false, 86),
  ('FA ON-GROUND ACTIVATION (EPIC) - M4 LEVEL', 26642.00, 'per day', false, 87),
  ('FA ON-GROUND ACTIVATION (HEAVY) - MPL S10 PLAYOFF LEVEL', 13321.00, 'per day', false, 88),
  ('FA ON-GROUND ACTIVATION (MEDIUM) - MPL RS LEVEL', 7958.00, 'per day', false, 89),
  ('FA ON-GROUND ACTIVATION (SIMPLE)', 4152.00, 'per day', false, 90),
  ('FLOOR OFFICER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 91),
  ('FLOOR OFFICER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 92),
  ('FLOOR OFFICER INT - WEEKDAYS', 692.00, 'per day', false, 93),
  ('FLOOR OFFICER INT - WEEKEND', 605.50, 'per day', false, 94),
  ('FOOD SET', 173.00, 'per day', false, 95),
  ('GELANG RUBER', 27.68, 'per day', false, 96),
  ('GFX OPERATOR INT - TRAVEL OTHERS', 1470.50, 'per day', false, 97),
  ('GFX OPERATOR INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 98),
  ('GFX OPERATOR INT - WEEKDAYS', 692.00, 'per day', false, 99),
  ('GFX OPERATOR INT - WEEKEND', 605.50, 'per day', false, 100),
  ('HIGH DETAIL 3D SCENE', 32870.00, 'per day', false, 101),
  ('HIGH STAND HEAVY DUTY', 69.20, 'per day', false, 102),
  ('HIGH STAND WITH ROLLER', 294.10, 'per day', false, 103),
  ('HOSPITALITY MANAGER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 104),
  ('HOSPITALITY MANAGER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 105),
  ('HOSPITALITY MANAGER INT - WEEKDAYS', 692.00, 'per day', false, 106),
  ('HOSPITALITY MANAGER INT - WEEKEND', 605.50, 'per day', false, 107),
  ('HOSPITALITY OFFICER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 108),
  ('HOSPITALITY OFFICER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 109),
  ('HOSPITALITY OFFICER INT - WEEKDAYS', 692.00, 'per day', false, 110),
  ('HOSPITALITY OFFICER INT - WEEKEND', 605.50, 'per day', false, 111),
  ('IG FEED MACRO INFLUENCER 100K - 199K', 8650.00, 'per day', false, 112),
  ('IG FEED MACRO INFLUENCER 200K - 299K', 12110.00, 'per day', false, 113),
  ('IG FEED MACRO INFLUENCER 300K - 499K', 17300.00, 'per day', false, 114),
  ('IG FEED MACRO INFLUENCER 500K - 999K', 27680.00, 'per day', false, 115),
  ('IG FEED MEGA INFLUENCER 1M+', 51900.00, 'per day', false, 116),
  ('IG FEED NANO INFLUENCER 1 - 9K', 2595.00, 'per day', false, 117),
  ('IG REELS MACRO INFLUENCER 100K - 199K', 12110.00, 'per day', false, 118),
  ('IG REELS MACRO INFLUENCER 200K - 299K', 17300.00, 'per day', false, 119),
  ('IG REELS MACRO INFLUENCER 300K - 499K', 24220.00, 'per day', false, 120),
  ('IG REELS MACRO INFLUENCER 500K - 999K', 44980.00, 'per day', false, 121),
  ('IG REELS MEGA INFLUENCER 1M+', 103800.00, 'per day', false, 122),
  ('IG REELS NANO INFLUENCER 1 - 9K', 3460.00, 'per day', false, 123),
  ('IG STORY MACRO INFLUENCER 100K - 199K', 3460.00, 'per day', false, 124),
  ('IG STORY MACRO INFLUENCER 200K - 299K', 5190.00, 'per day', false, 125),
  ('IG STORY MACRO INFLUENCER 300K - 499K', 6920.00, 'per day', false, 126),
  ('IG STORY MACRO INFLUENCER 500K - 999K', 10380.00, 'per day', false, 127),
  ('IG STORY MEGA INFLUENCER 1M+', 17300.00, 'per day', false, 128),
  ('IG STORY NANO INFLUENCER 1 - 9K', 1038.00, 'per day', false, 129),
  ('ILLUSTRATION (FULL BACKGROUND)', 5190.00, 'per day', false, 130),
  ('ILLUSTRATION (SIMPLE BACKGROUND)', 2595.00, 'per day', false, 131),
  ('KEY ICON', 2076.00, 'per day', false, 132),
  ('KEY VISUAL (USING 3D/ILLUSTRATION)', 21625.00, 'per day', false, 133),
  ('KEY VISUAL 2D', 13321.00, 'per day', false, 134),
  ('LAYOUT', 4152.00, 'per day', false, 135),
  ('LEAGUE OPERATION INT - TRAVEL OTHERS', 1470.50, 'per day', false, 136),
  ('LEAGUE OPERATION INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 137),
  ('LEAGUE OPERATION INT - WEEKDAYS', 692.00, 'per day', false, 138),
  ('LEAGUE OPERATION INT - WEEKEND', 605.50, 'per day', false, 139),
  ('LED ASSETS (PACKAGE A) UP TO 10 STATIC ITEMS', 12715.50, 'per day', false, 140),
  ('LED ASSETS (PACKAGE B UP TO 20 STATIC ITEMS', 25258.00, 'per day', false, 141),
  ('LED GAME ASSETS PACKAGE A (SIMPLE)', 12715.50, 'per day', false, 142),
  ('LED GAME ASSETS PACKAGE B (MEDIUM)', 25950.00, 'per day', false, 143),
  ('LED GAME ASSETS PACKAGE C (HIGH)', 38233.00, 'per day', false, 144),
  ('LED SHOW ASSETS (PRICE IS PER 60S)', 64010.00, 'per day', false, 145),
  ('LEGRAND 16 AMPERE 10 M', 173.00, 'per day', false, 146),
  ('LEGRAND 16 AMPERE 20 M', 346.00, 'per day', false, 147),
  ('LEGRAND 16 AMPERE 50 M', 865.00, 'per day', false, 148),
  ('LEGRAND 32 AMPERE 50 M', 2076.00, 'per day', false, 149),
  ('LOOPING KV BACKGROUND', 3979.00, 'per day', false, 150),
  ('MASTER PRIME SERIES PACKAGE (5)', 19030.00, 'per day', false, 151),
  ('MEALS CLIENT CATERING/GFB', 173.00, 'per day', false, 152),
  ('MEALS CREW CATERING/GFB', 103.80, 'per day', false, 153),
  ('MEALS MEDIA CATERING/GFB', 173.00, 'per day', false, 154),
  ('MEALS PLAYER CATERING/GFB', 173.00, 'per day', false, 155),
  ('MEALS TALENT CATERING/GFB', 173.00, 'per day', false, 156),
  ('MEDIUM 3D SCENE', 19030.00, 'per day', false, 157),
  ('MEDIUM BCD. ASSETS ANIMATION', 3114.00, 'per day', false, 158),
  ('MEDIUM INSTALATION', 9515.00, 'per day', false, 159),
  ('MEDKIT', 1730.00, 'per day', false, 160),
  ('MINERAL WATER', 138.40, 'per day', false, 161),
  ('MULTIPURPOSE CLOTH', 692.00, 'per day', false, 162),
  ('MULTIPURPOSE LADDER', 2422.00, 'per day', false, 163),
  ('MULTIPURPOSE STAND', 1730.00, 'per day', false, 164),
  ('MULTIVIEW 16', 3460.00, 'per day', false, 165),
  ('MULTIVIEW 4', 1211.00, 'per day', false, 166),
  ('MULTPIN 16CH', 2422.00, 'per day', false, 167),
  ('MUXLAB FO CONVERTER', 4844.00, 'per day', false, 168),
  ('OPENING VIDEO', 34600.00, 'per day', false, 169),
  ('OPERATIONAL COST PROJECT SIZE A', 3460.00, 'per day', false, 170),
  ('OPERATIONAL COST PROJECT SIZE B', 10380.00, 'per day', false, 171),
  ('OPERATIONAL COST PROJECT SIZE C', 17300.00, 'per day', false, 172),
  ('PANEL BOX', 1038.00, 'per day', false, 173),
  ('PAPAN BUNGA WEDDING / TURUT BERDUKA CITA', 1038.00, 'per day', false, 174),
  ('PHOTO PREVIEW DEVICE', 865.00, 'per day', false, 175),
  ('PHOTOCOPY BLACK & WHITE', 3.46, 'per day', false, 176),
  ('PHOTOCOPY COLOUR', 17.30, 'per day', false, 177),
  ('PHOTOGRAPHER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 178),
  ('PHOTOGRAPHER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 179),
  ('PHOTOGRAPHER INT - WEEKDAYS', 692.00, 'per day', false, 180),
  ('PHOTOGRAPHER INT - WEEKEND', 605.50, 'per day', false, 181),
  ('PRODUCER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 182),
  ('PRODUCER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 183),
  ('PRODUCER INT - WEEKDAYS', 692.00, 'per day', false, 184),
  ('PRODUCER INT - WEEKEND', 605.50, 'per day', false, 185),
  ('PRODUCTION MANAGER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 186),
  ('PRODUCTION MANAGER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 187),
  ('PRODUCTION MANAGER INT - WEEKDAYS', 692.00, 'per day', false, 188),
  ('PRODUCTION MANAGER INT - WEEKEND', 605.50, 'per day', false, 189),
  ('PRODUCTION OFFICER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 190),
  ('PRODUCTION OFFICER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 191),
  ('PRODUCTION OFFICER INT - WEEKDAYS', 692.00, 'per day', false, 192),
  ('PRODUCTION OFFICER INT - WEEKEND', 605.50, 'per day', false, 193),
  ('PROJECT MANAGER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 194),
  ('PROJECT MANAGER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 195),
  ('PROJECT MANAGER INT - WEEKDAYS', 692.00, 'per day', false, 196),
  ('PROJECT MANAGER INT - WEEKEND', 605.50, 'per day', false, 197),
  ('PROJECT OFFICER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 198),
  ('PROJECT OFFICER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 199),
  ('PROJECT OFFICER INT - WEEKDAYS', 692.00, 'per day', false, 200),
  ('PROJECT OFFICER INT - WEEKEND', 605.50, 'per day', false, 201),
  ('QA ELECTRONICS', 865.00, 'per day', false, 202),
  ('REFRESHMENT CLIENT', 173.00, 'per day', false, 203),
  ('REFRESHMENT CREW', 103.80, 'per day', false, 204),
  ('REFRESHMENT MEDIA', 173.00, 'per day', false, 205),
  ('REFRESHMENT PLAYER', 173.00, 'per day', false, 206),
  ('REFRESHMENT TALENT', 173.00, 'per day', false, 207),
  ('RIDERS', 173.00, 'per day', false, 208),
  ('SCRIPT WRITER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 209),
  ('SCRIPT WRITER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 210),
  ('SCRIPT WRITER INT - WEEKDAYS', 692.00, 'per day', false, 211),
  ('SCRIPT WRITER INT - WEEKEND', 605.50, 'per day', false, 212),
  ('SENNEISER e604', 519.00, 'per day', false, 213),
  ('SENNEISER EW100 G3', 1211.00, 'per day', false, 214),
  ('SIMPLE BCD. ASSETS ANIMATION', 2076.00, 'per day', false, 215),
  ('SIMPLE BRANDING (MANDATORY FOR PACKAGE C & D)', 12975.00, 'per day', false, 216),
  ('SOCIAL MEDIA MANAGER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 217),
  ('SOCIAL MEDIA MANAGER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 218),
  ('SOCIAL MEDIA MANAGER INT - WEEKDAYS', 692.00, 'per day', false, 219),
  ('SOCIAL MEDIA MANAGER INT - WEEKEND', 605.50, 'per day', false, 220),
  ('SOCIAL MEDIA OFFICER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 221),
  ('SOCIAL MEDIA OFFICER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 222),
  ('SOCIAL MEDIA OFFICER INT - WEEKDAYS', 692.00, 'per day', false, 223),
  ('SOCIAL MEDIA OFFICER INT - WEEKEND', 605.50, 'per day', false, 224),
  ('SOCIAL MEDIA POST (FULL MOTION)', 2422.00, 'per day', false, 225),
  ('SOCIAL MEDIA POST (FULL MOTION) - 2 RATIO', 3114.00, 'per day', false, 226),
  ('SOCIAL MEDIA POST (RELAYOUT)', 259.50, 'per day', false, 227),
  ('SOCIAL MEDIA POST PER IMAGE (MIN 10/MONTH)', 951.50, 'per day', false, 228),
  ('SOCIAL MEDIA POST PER IMAGE (MIN 30/MONTH)', 865.00, 'per day', false, 229),
  ('SOCIAL MEDIA POST PER IMAGE (MIN 60/MONTH)', 795.80, 'per day', false, 230),
  ('SOCIAL MEDIA POST PER POST', 1384.00, 'per day', false, 231),
  ('SPANSET 1TON', 865.00, 'per day', false, 232),
  ('SPEAKON CANARE 2X1.5MM', 346.00, 'per day', false, 233),
  ('SPEAKON CANARE 2X2.5MM', 519.00, 'per day', false, 234),
  ('SPEAKON CANARE 2X2.5MM LINK', 138.40, 'per day', false, 235),
  ('SPEAKON CANARE 4X2.5MM', 865.00, 'per day', false, 236),
  ('SPEAKON S2CEB 4X4MM', 1730.00, 'per day', false, 237),
  ('SPEAKON TASKER 4X2.5MM', 2076.00, 'per day', false, 238),
  ('STAND BOOK', 259.50, 'per day', false, 239),
  ('STAND GUITAR', 259.50, 'per day', false, 240),
  ('STAND GUITAR 3in1', 519.00, 'per day', false, 241),
  ('STAND KEYBOARD DOUBLE', 692.00, 'per day', false, 242),
  ('STAND KEYBOARD SINGLE', 432.50, 'per day', false, 243),
  ('STOP KONTAK ISI 3/4 (UTICON)', 103.80, 'per day', false, 244),
  ('STORYBOARD', 6920.00, 'per day', false, 245),
  ('STREAM ENGINEER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 246),
  ('STREAM ENGINEER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 247),
  ('STREAM ENGINEER INT - WEEKDAYS', 692.00, 'per day', false, 248),
  ('STREAM ENGINEER INT - WEEKEND', 605.50, 'per day', false, 249),
  ('STYROFOAM / POLYFOAM', 328.70, 'per day', false, 250),
  ('SUMIRE PRIME SERIES PACKAGE (5)', 6920.00, 'per day', false, 251),
  ('TALENT MANAGER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 252),
  ('TALENT MANAGER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 253),
  ('TALENT MANAGER INT - WEEKDAYS', 692.00, 'per day', false, 254),
  ('TALENT MANAGER INT - WEEKEND', 605.50, 'per day', false, 255),
  ('TALENT OFFICER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 256),
  ('TALENT OFFICER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 257),
  ('TALENT OFFICER INT - WEEKDAYS', 692.00, 'per day', false, 258),
  ('TALENT OFFICER INT - WEEKEND', 605.50, 'per day', false, 259),
  ('TALKSHOW', 13840.00, 'per day', false, 260),
  ('TECHNICAL DIRECTOR INT - TRAVEL OTHERS', 1470.50, 'per day', false, 261),
  ('TECHNICAL DIRECTOR INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 262),
  ('TECHNICAL DIRECTOR INT - WEEKDAYS', 692.00, 'per day', false, 263),
  ('TECHNICAL DIRECTOR INT - WEEKEND', 605.50, 'per day', false, 264),
  ('TEMPLATE COUNTDOWN VIDEO', 3979.00, 'per day', false, 265),
  ('TERANEX MINI', 1211.00, 'per day', false, 266),
  ('TIKET GELANG', 3.11, 'per day', false, 267),
  ('TRAVEL GUIDE BOOK', 103.80, 'per day', false, 268),
  ('TRAVEL INSURANCE', 5190.00, 'per day', false, 269),
  ('TS S2CEB COBRA', 173.00, 'per day', false, 270),
  ('TUMPENG', 5190.00, 'per day', false, 271),
  ('ULTRA PRIME SERIES PACKAGE (5)', 6920.00, 'per day', false, 272),
  ('VARIOUS CLAMP', 86.50, 'per day', false, 273),
  ('VIDEO EDITOR INT - TRAVEL OTHERS', 1470.50, 'per day', false, 274),
  ('VIDEO EDITOR INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 275),
  ('VIDEO EDITOR INT - WEEKDAYS', 692.00, 'per day', false, 276),
  ('VIDEO EDITOR INT - WEEKEND', 605.50, 'per day', false, 277),
  ('VIDEO SERIES', 17300.00, 'per day', false, 278),
  ('VIDEOGRAPHER INT - TRAVEL OTHERS', 1470.50, 'per day', false, 279),
  ('VIDEOGRAPHER INT - TRAVEL SG JP KR', 2162.50, 'per day', false, 280),
  ('VIDEOGRAPHER INT - WEEKDAYS', 692.00, 'per day', false, 281),
  ('VIDEOGRAPHER INT - WEEKEND', 605.50, 'per day', false, 282),
  ('VMB TLA - 150', 5190.00, 'per day', false, 283),
  ('WELCOMING CAKE PLAYER / VIP / TALENT', 692.00, 'per day', false, 284),
  ('WIRELESS VIDEO HOLLYLAND', 3460.00, 'per day', false, 285),
  ('XLR S2CEB VIPER', 173.00, 'per day', false, 286)
) AS v(name, base_rate, unit, is_fab, so)
WHERE c.name = 'Other Equipment';

-- ----------------------------------------------------------------------------
-- RLS REMINDER: keep Row Level Security DISABLED for this demo (the admin panel
-- writes with the public anon key), OR enable RLS and add permissive anon
-- policies, e.g.:
--   ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY "demo all access" ON settings   FOR ALL TO anon USING (true) WITH CHECK (true);
--   CREATE POLICY "demo all access" ON categories FOR ALL TO anon USING (true) WITH CHECK (true);
--   CREATE POLICY "demo all access" ON services   FOR ALL TO anon USING (true) WITH CHECK (true);
-- ============================================================================
