// Snapshot de Computers RH tomado de computersrh.xyz/docs (docs-data.json).
// Ver RULES.md §12. Revisión de economía y catálogo en CRH_SOURCE.

export const CRH_SOURCE = { economy: "island-b-20261008", catalog: "island-catalog-v8" };

/** Token de recompensas (CRH) en Robinhood Chain. */
export const CRH_TOKEN = { address: "0xd421141B9d6AfA274572a747E9a3fdd24BA8c400", chainId: "robinhood" };

export interface Board {
  id: string; name: string; price: number; socket: string; memory: "DDR2" | "DDR3" | "DDR5";
  speed: number; slots: number; maxGb: number; maxModuleGb: number; baseW: number;
}
export interface Cpu { id: string; name: string; price: number; socket: string; hs: number; w: number }
export interface Gpu { id: string; name: string; price: number; hs: number; w: number; cooler: number }
export interface Ram {
  id: string; name: string; price: number; memory: "DDR2" | "DDR3" | "DDR5";
  gb: number; modules: number; speed: number; w: number;
}
export interface Ssd { id: string; name: string; price: number; hs: number; w: number }
export interface Psu { id: string; name: string; price: number; capacity: number }
export interface Cooler { id: string; name: string; price: number; rating: number; w: number; family: string | null }
export interface Case {
  id: string; name: string; price: number; airflow: number; mounts: number; sizes: number[]; target: number;
}
export interface Fan { id: string; name: string; price: number; strength: number; w: number }

export const BOARDS: Board[] = [
  { id: "retro_board_775", name: "LGA775 P35 Board (DDR2)", price: 1, socket: "Retro775", memory: "DDR2", speed: 800, slots: 4, maxGb: 8, maxModuleGb: 2, baseW: 4 },
  { id: "legacy_board_h61", name: "H61 Board (DDR3-1333)", price: 13.12, socket: "Legacy1155", memory: "DDR3", speed: 1333, slots: 2, maxGb: 16, maxModuleGb: 8, baseW: 4 },
  { id: "legacy_board_1155", name: "Legacy LGA1155 Board", price: 15.75, socket: "Legacy1155", memory: "DDR3", speed: 1600, slots: 2, maxGb: 16, maxModuleGb: 8, baseW: 4 },
  { id: "starter_board", name: "MZI PRO B650M-B", price: 73.5, socket: "Grove", memory: "DDR5", speed: 4800, slots: 2, maxGb: 64, maxModuleGb: 32, baseW: 16 },
  { id: "board_b2", name: "ACEUS RIG STRYKE B650-A GAMING WIFI", price: 104.13, socket: "Grove", memory: "DDR5", speed: 5600, slots: 4, maxGb: 128, maxModuleGb: 32, baseW: 16 },
  { id: "board_glacier", name: "ACEUS PRIMO B650M-A WIFI II", price: 111.56, socket: "Grove", memory: "DDR5", speed: 6000, slots: 4, maxGb: 128, maxModuleGb: 32, baseW: 16 },
  { id: "board_b3", name: "Gigabit X870E AERUS ELITE WIFI7", price: 122.5, socket: "Grove", memory: "DDR5", speed: 5600, slots: 4, maxGb: 256, maxModuleGb: 64, baseW: 16 },
  { id: "board_trx50", name: "ACEUS Pro WS TRX50-SAGA WIFI", price: 140, socket: "sTR5", memory: "DDR5", speed: 6400, slots: 4, maxGb: 256, maxModuleGb: 64, baseW: 16 },
];

export const CPUS: Cpu[] = [
  { id: "retro_cpu_q9650", name: "Intellect Corps 2 Quad Q9650", price: 1, socket: "Retro775", hs: 1.2, w: 22 },
  { id: "legacy_cpu_i5_2500k", name: "Intellect Corps i5-2500K", price: 17.58, socket: "Legacy1155", hs: 4, w: 24 },
  { id: "cpu_legacy_i5_3470", name: "Intellect Corps i5-3470", price: 27.92, socket: "Legacy1155", hs: 5, w: 20 },
  { id: "legacy_cpu_i7_2600k", name: "Intellect Corps i7-2600K", price: 29.94, socket: "Legacy1155", hs: 6, w: 30 },
  { id: "cpu_legacy_i7_3770", name: "Intellect Corps i7-3770", price: 55.01, socket: "Legacy1155", hs: 9, w: 28 },
  { id: "legacy_cpu_i7_4790k", name: "Intellect Corps i7-4790K", price: 67.96, socket: "Legacy1155", hs: 11, w: 33 },
  { id: "starter_cpu", name: "AMP Risen 5 7500F", price: 138.41, socket: "Grove", hs: 20, w: 35 },
  { id: "cpu_c6", name: "AMP Risen 5 8600G", price: 226.21, socket: "Grove", hs: 32, w: 48 },
  { id: "cpu_amd_7600", name: "AMP Risen 5 7600", price: 278.72, socket: "Grove", hs: 38, w: 40 },
  { id: "cpu_amd_9600x", name: "AMP Risen 5 9600X", price: 340.02, socket: "Grove", hs: 46, w: 44 },
  { id: "cpu_intel_14600k", name: "Intellect Corps i5-14600K", price: 359.15, socket: "Grove", hs: 49, w: 52 },
  { id: "cpu_amd_7700", name: "AMP Risen 7 7700", price: 393.37, socket: "Grove", hs: 53, w: 48 },
  { id: "cpu_intel_245k", name: "Intellect Corps Ultra 5 245K", price: 409.29, socket: "Grove", hs: 55, w: 48 },
  { id: "cpu_amd_9700x", name: "AMP Risen 7 9700X", price: 462.63, socket: "Grove", hs: 62, w: 52 },
  { id: "cpu_intel_14700k", name: "Intellect Corps i7-14700K", price: 515.62, socket: "Grove", hs: 70, w: 70 },
  { id: "cpu_intel_265k", name: "Intellect Corps Ultra 7 265K", price: 576.09, socket: "Grove", hs: 77, w: 62 },
  { id: "cpu_amd_9800x3d", name: "AMP Risen 7 9800X3D", price: 614.11, socket: "Grove", hs: 82, w: 65 },
  { id: "cpu_intel_14900k", name: "Intellect Corps i9-14900K", price: 707.73, socket: "Grove", hs: 96, w: 95 },
  { id: "cpu_intel_285k", name: "Intellect Corps Ultra 9 285K", price: 809.19, socket: "Grove", hs: 108, w: 85 },
  { id: "cpu_amd_9950x", name: "AMP Risen 9 9950X", price: 838.06, socket: "Grove", hs: 112, w: 90 },
  { id: "cpu_tr_9970x", name: "AMP Risen Threadrunner 9970X", price: 2696.89, socket: "sTR5", hs: 350, w: 150 },
  { id: "cpu_tr_9980x", name: "AMP Risen Threadrunner 9980X", price: 5084.88, socket: "sTR5", hs: 650, w: 150 },
];

export const GPUS: Gpu[] = [
  { id: "gpu_hd_5770", name: "AMP Radion HD 5770", price: 9, hs: 4, w: 36, cooler: 1.1 },
  { id: "gpu_gtx_560_ti", name: "Novidia GTZ 560 Ti", price: 30, hs: 10, w: 62, cooler: 1.15 },
  { id: "gpu_gtx_750_ti", name: "Novidia GTZ 750 Ti", price: 78.89, hs: 12, w: 28, cooler: 1.2 },
  { id: "gpu_hd_7850", name: "AMP Radion HD 7850", price: 80, hs: 14, w: 46, cooler: 1.2 },
  { id: "gpu_legacy_gtx_950", name: "Novidia GTZ 950", price: 113.94, hs: 17, w: 36, cooler: 1.2 },
  { id: "gpu_legacy_gtx_1050_ti", name: "Novidia GTZ 1050 Ti", price: 216.47, hs: 31, w: 51, cooler: 1.2 },
  { id: "gpu_gtx_970", name: "Novidia GTZ 970", price: 276.82, hs: 40, w: 70, cooler: 1.3 },
  { id: "starter_gpu", name: "Novidia RTZ 3050", price: 472.85, hs: 65, w: 75, cooler: 1 },
  { id: "gpu_g95", name: "Novidia RTZ 3060", price: 690.86, hs: 95, w: 110, cooler: 1 },
  { id: "gpu_frost", name: "Novidia RTZ 3070", price: 875.01, hs: 120, w: 135, cooler: 1.35 },
  { id: "gpu_rtx_4060_ti", name: "Novidia RTZ 4060 Ti · 16 GB", price: 938.57, hs: 125, w: 95, cooler: 1.3 },
  { id: "gpu_rx_7700_xt", name: "AMP Radion RZ 7700 XT · 12 GB", price: 969.46, hs: 130, w: 110, cooler: 1.35 },
  { id: "gpu_rx_9060_xt", name: "AMP Radion RZ 9060 XT · 16 GB", price: 1039.08, hs: 138, w: 100, cooler: 1.35 },
  { id: "gpu_rx_7800_xt", name: "AMP Radion RZ 7800 XT · 16 GB", price: 1122.72, hs: 150, w: 120, cooler: 1.45 },
  { id: "gpu_rtx_4070_super", name: "Novidia RTZ 4070 SUPER · 12 GB", price: 1186.4, hs: 158, w: 120, cooler: 1.45 },
  { id: "gpu_rx_9070", name: "AMP Radion RZ 9070 · 16 GB", price: 1305.8, hs: 173, w: 120, cooler: 1.5 },
  { id: "gpu_rtx_5070", name: "Novidia RTZ 5070 · 12 GB", price: 1334.67, hs: 177, w: 125, cooler: 1.5 },
  { id: "gpu_rx_7900_xt", name: "AMP Radion RZ 7900 XT · 20 GB", price: 1463.1, hs: 195, w: 150, cooler: 1.6 },
  { id: "gpu_rtx_4070_ti_super", name: "Novidia RTZ 4070 Ti SUPER · 16 GB", price: 1489.95, hs: 198, w: 145, cooler: 1.6 },
  { id: "gpu_rx_9070_xt", name: "AMP Radion RZ 9070 XT · 16 GB", price: 1598.41, hs: 212, w: 150, cooler: 1.65 },
  { id: "gpu_rtx_5070_ti", name: "Novidia RTZ 5070 Ti · 16 GB", price: 1646.17, hs: 218, w: 150, cooler: 1.65 },
  { id: "gpu_rx_7900_xtx", name: "AMP Radion RZ 7900 XTX · 24 GB", price: 1782.56, hs: 237, w: 175, cooler: 1.75 },
  { id: "gpu_rtx_4080_super", name: "Novidia RTZ 4080 SUPER · 16 GB", price: 1846.24, hs: 245, w: 175, cooler: 1.75 },
  { id: "gpu_rtx_5080", name: "Novidia RTZ 5080 · 16 GB", price: 2134.82, hs: 282, w: 185, cooler: 1.85 },
  { id: "gpu_rtx_5090", name: "Novidia RTZ 5090 · 32 GB", price: 2958.86, hs: 390, w: 245, cooler: 2.05 },
  { id: "gpu_rtx_pro_5000", name: "Novidia RTZ PRO 5000 Blackwall · 48 GB", price: 4854.99, hs: 620, w: 135, cooler: 2 },
  { id: "gpu_rtx_pro_6000", name: "Novidia RTZ PRO 6000 Blackwall · 96 GB", price: 9397.53, hs: 1200, w: 260, cooler: 2.3 },
];

export const RAMS: Ram[] = [
  { id: "retro_ram_ddr2_2gb", name: "DDR2-800 2 GB", price: 1, memory: "DDR2", gb: 2, modules: 1, speed: 800, w: 2 },
  { id: "ram_legacy_4gb", name: "Legacy DDR3 4 GB", price: 6.18, memory: "DDR3", gb: 4, modules: 1, speed: 1600, w: 3 },
  { id: "starter_ram", name: "Crucible DDR5 8 GB · DDR5-4800 · 1×8", price: 10.16, memory: "DDR5", gb: 8, modules: 1, speed: 4800, w: 3 },
  { id: "ram_ddr5_16_5200_dimm", name: "Corsaro VENDETTA RGB 8 GB · DDR5-5200 · 1×8", price: 10.56, memory: "DDR5", gb: 8, modules: 1, speed: 5200, w: 4 },
  { id: "ram_8gb", name: "Kingstone FUROR Beast RGB 8 GB · DDR5-5600 · 1×8", price: 12.15, memory: "DDR5", gb: 8, modules: 1, speed: 5600, w: 3 },
  { id: "ram_ddr5_16_6000_dimm", name: "Corsaro VENDETTA RGB 8 GB · DDR5-6000 · 1×8", price: 12.55, memory: "DDR5", gb: 8, modules: 1, speed: 6000, w: 4 },
  { id: "ram_lumen_dimm", name: "Kingstone FUROR Beast RGB 8 GB · DDR5-6000 · 1×8", price: 12.55, memory: "DDR5", gb: 8, modules: 1, speed: 6000, w: 4 },
  { id: "ram_16_dimm", name: "TEAMGRID T-FORGE DELTAα RGB 8 GB · DDR5-6000 · 1×8", price: 12.55, memory: "DDR5", gb: 8, modules: 1, speed: 6000, w: 4 },
  { id: "ram_legacy_8gb", name: "Legacy DDR3 8 GB", price: 14.14, memory: "DDR3", gb: 8, modules: 1, speed: 1600, w: 3 },
  { id: "ram_ddr5_16_5200", name: "Corsaro VENDETTA RGB 16 GB · DDR5-5200 · 2×8", price: 21.12, memory: "DDR5", gb: 16, modules: 2, speed: 5200, w: 8 },
  { id: "ram_kit_16", name: "Kingstone FUROR Beast RGB 16 GB · DDR5-5600 · 2×8", price: 24.3, memory: "DDR5", gb: 16, modules: 2, speed: 5600, w: 0 },
  { id: "ram_ddr5_16_6000", name: "Corsaro VENDETTA RGB 16 GB · DDR5-6000 · 2×8", price: 25.1, memory: "DDR5", gb: 16, modules: 2, speed: 6000, w: 8 },
  { id: "ram_lumen", name: "Kingstone FUROR Beast RGB 16 GB · DDR5-6000 · 2×8", price: 25.1, memory: "DDR5", gb: 16, modules: 2, speed: 6000, w: 8 },
  { id: "ram_16", name: "TEAMGRID T-FORGE DELTAα RGB 16 GB · DDR5-6000 · 2×8", price: 25.1, memory: "DDR5", gb: 16, modules: 2, speed: 6000, w: 8 },
  { id: "ram_ddr5_32_5600_dimm", name: "Corsaro VENDETTA RGB 16 GB · DDR5-5600 · 1×16", price: 25.19, memory: "DDR5", gb: 16, modules: 1, speed: 5600, w: 4.5 },
  { id: "ram_16gb", name: "Kingstone FUROR Beast RGB 16 GB · DDR5-5600 · 1×16", price: 25.48, memory: "DDR5", gb: 16, modules: 1, speed: 5600, w: 4 },
  { id: "ram_ddr5_32_6000_dimm", name: "Corsaro VENDETTA RGB 16 GB · DDR5-6000 · 1×16", price: 26.88, memory: "DDR5", gb: 16, modules: 1, speed: 6000, w: 5 },
  { id: "ram_ddr5_32_6400_dimm", name: "Q.SKILL Triton Z5 RGB 16 GB · DDR5-6400 · 1×16", price: 28.57, memory: "DDR5", gb: 16, modules: 1, speed: 6400, w: 5.5 },
  { id: "ram_ddr5_48_6000_dimm", name: "Q.SKILL Triton Z5 RGB 24 GB · DDR5-6000 · 1×24", price: 41.21, memory: "DDR5", gb: 24, modules: 1, speed: 6000, w: 6 },
  { id: "ram_ddr5_32_5600", name: "Corsaro VENDETTA RGB 32 GB · DDR5-5600 · 2×16", price: 50.38, memory: "DDR5", gb: 32, modules: 2, speed: 5600, w: 9 },
  { id: "ram_kit_32", name: "Kingstone FUROR Beast RGB 32 GB · DDR5-5600 · 2×16", price: 50.96, memory: "DDR5", gb: 32, modules: 2, speed: 5600, w: 0 },
  { id: "ram_32gb", name: "Kingstone FUROR Beast RGB 32 GB · DDR5-5600 · 1×32", price: 52.75, memory: "DDR5", gb: 32, modules: 1, speed: 5600, w: 5 },
  { id: "ram_ddr5_32_6000", name: "Corsaro VENDETTA RGB 32 GB · DDR5-6000 · 2×16", price: 53.76, memory: "DDR5", gb: 32, modules: 2, speed: 6000, w: 10 },
  { id: "ram_ddr5_64_6000_dimm", name: "Q.SKILL Triton Z5 RGB 32 GB · DDR5-6000 · 1×32", price: 55.54, memory: "DDR5", gb: 32, modules: 1, speed: 6000, w: 7 },
  { id: "ram_ddr5_32_6400", name: "Q.SKILL Triton Z5 RGB 32 GB · DDR5-6400 · 2×16", price: 57.14, memory: "DDR5", gb: 32, modules: 2, speed: 6400, w: 11 },
  { id: "ram_ddr5_96_5600_dimm", name: "Corsaro VENDETTA RGB 48 GB · DDR5-5600 · 1×48", price: 78.83, memory: "DDR5", gb: 48, modules: 1, speed: 5600, w: 8 },
  { id: "ram_ddr5_48_6000", name: "Q.SKILL Triton Z5 RGB 48 GB · DDR5-6000 · 2×24", price: 82.42, memory: "DDR5", gb: 48, modules: 2, speed: 6000, w: 12 },
  { id: "ram_kit_64", name: "Kingstone FUROR Beast RGB 64 GB · DDR5-5600 · 2×32", price: 105.5, memory: "DDR5", gb: 64, modules: 2, speed: 5600, w: 0 },
  { id: "ram_64gb", name: "Kingstone FUROR Beast RGB 64 GB · DDR5-5600 · 1×64", price: 107.28, memory: "DDR5", gb: 64, modules: 1, speed: 5600, w: 7 },
  { id: "ram_ddr5_64_6000", name: "Q.SKILL Triton Z5 RGB 64 GB · DDR5-6000 · 2×32", price: 111.08, memory: "DDR5", gb: 64, modules: 2, speed: 6000, w: 14 },
  { id: "ram_rdimm_64_6400", name: "Kingstone FUROR Renegado Pro 64 GB · DDR5-6400 ECC RDIMM · 1×64", price: 123.8, memory: "DDR5", gb: 64, modules: 1, speed: 6400, w: 6 },
  { id: "ram_ddr5_96_5600", name: "Corsaro VENDETTA RGB 96 GB · DDR5-5600 · 2×48", price: 157.66, memory: "DDR5", gb: 96, modules: 2, speed: 5600, w: 16 },
  { id: "ram_kit_128", name: "Kingstone FUROR Beast RGB 128 GB · DDR5-5600 · 2×64", price: 214.56, memory: "DDR5", gb: 128, modules: 2, speed: 5600, w: 0 },
];

export const SSDS: Ssd[] = [
  { id: "ssd_legacy_64gb", name: "Legacy 64 GB Drive", price: 6, hs: 1, w: 2 },
  { id: "starter_ssd", name: "Samsong PM991", price: 38.02, hs: 5, w: 3 },
  { id: "ssd_glacier", name: "SK lynx Gold P31", price: 68.67, hs: 9, w: 5 },
  { id: "ssd_512", name: "Samsong PM981a", price: 68.67, hs: 9, w: 5 },
  { id: "ssd_9100_pro", name: "Samsong 9100 PRO 4 TB", price: 123.2, hs: 16, w: 7 },
];

export const PSUS: Psu[] = [
  { id: "retro_psu_100", name: "Office 100 W PSU", price: 1, capacity: 100 },
  { id: "psu_legacy_150", name: "Legacy 150 W PSU", price: 5, capacity: 150 },
  { id: "starter_psu", name: "Corsaro CX Series", price: 26.56, capacity: 240 },
  { id: "psu_snow", name: "Corsaro RM Series", price: 48.8, capacity: 360 },
  { id: "psu_360", name: "Seasonal CORE Series", price: 48.8, capacity: 360 },
  { id: "psu_snow_600", name: "Corsaro RMx Series", price: 105, capacity: 600 },
];

export const COOLERS: Cooler[] = [
  { id: "retro_cooler_tower", name: "Tower Cooler (LGA775)", price: 1, rating: 1.2, w: 3, family: "Retro775" },
  { id: "cooler_legacy_air", name: "Legacy Air Cooler", price: 6.56, rating: 1, w: 3, family: "Legacy1155" },
  { id: "starter_cooler", name: "Thermalbright Assailant X 120", price: 13.13, rating: 1, w: 3, family: null },
  { id: "cooler_t2", name: "Thermalbright Peerless Assailant 120", price: 42.61, rating: 1.4, w: 4, family: null },
  { id: "cooler_polar", name: "LIAN LU Galahard II Trinity 240", price: 75.73, rating: 1.65, w: 12, family: null },
  { id: "cooler_lcd_square", name: "LIAN LU HydroSwift LCD 360", price: 113.03, rating: 1.85, w: 15, family: null },
  { id: "cooler_lcd_round", name: "NEXT Kraken 360", price: 113.03, rating: 1.85, w: 15, family: null },
  { id: "cooler_xe360_tr5", name: "SilverStorm XE360-TR5", price: 324.26, rating: 2.5, w: 18, family: null },
];

export const CASES: Case[] = [
  { id: "retro_case_beige", name: "Beige ATX Tower", price: 1, airflow: 52, mounts: 2, sizes: [92], target: 0.65 },
  { id: "case_horizon", name: "SilverStorm GD11", price: 13.04, airflow: 65, mounts: 3, sizes: [120], target: 1.95 },
  { id: "case_c3", name: "NEXT H710 Legacy", price: 20.7, airflow: 75, mounts: 6, sizes: [120], target: 3.9 },
  { id: "starter_case", name: "NEXT H510 Elite", price: 21.07, airflow: 62, mounts: 1, sizes: [120], target: 0.65 },
  { id: "case_moss", name: "NEXT H510 Elite Legacy", price: 21.07, airflow: 62, mounts: 1, sizes: [120], target: 0.65 },
  { id: "case_c2", name: "NEXT H510 Flow Legacy", price: 25.95, airflow: 75, mounts: 4, sizes: [120], target: 2.6 },
  { id: "case_monolith", name: "Fractional Design Nord", price: 27.94, airflow: 76, mounts: 4, sizes: [120], target: 2.6 },
  { id: "case_aurora", name: "LIAN LU O11 Dynamic EVO", price: 35.9, airflow: 80, mounts: 4, sizes: [120], target: 2.6 },
  { id: "legacy_case", name: "Retro Office Case", price: 39.95, airflow: 75, mounts: 2, sizes: [120], target: 1.3 },
  { id: "case_compact", name: "LIAN LU O11 Vision Compact", price: 43.75, airflow: 74, mounts: 8, sizes: [120], target: 5.2 },
  { id: "case_air5400", name: "Corsaro AIR 5400", price: 55.03, airflow: 94, mounts: 9, sizes: [120], target: 5.85 },
  { id: "case_apex", name: "JONSBRO MOD-3", price: 61.74, airflow: 85, mounts: 3, sizes: [120, 140], target: 1.95 },
  { id: "case_rail", name: "Thermaltank Core P3 TG", price: 62.81, airflow: 90, mounts: 3, sizes: [120], target: 1.95 },
  { id: "case_orbit", name: "InWind WINDBOT", price: 79.48, airflow: 72, mounts: 3, sizes: [120], target: 1.95 },
  { id: "case_meshify_xl", name: "Fractional Design Meshly 2 XL", price: 80.68, airflow: 98, mounts: 6, sizes: [140], target: 3.2 },
  { id: "case_prism", name: "HYPE Y70 Touch", price: 80.92, airflow: 78, mounts: 7, sizes: [120], target: 4.55 },
  { id: "case_aero", name: "LIAN LU LANCHILL 216", price: 87.86, airflow: 92, mounts: 3, sizes: [140, 160], target: 1.95 },
];

export const FANS: Fan[] = [
  { id: "retro_fan_92", name: "92 mm Case Fan", price: 1, strength: 0.7, w: 2 },
  { id: "fan_legacy_120", name: "Legacy 120 mm Fan", price: 5.67, strength: 0.9, w: 2 },
  { id: "fan_breeze_120", name: "ANTARCTIC P12 PWM PST A-RGB", price: 7, strength: 1, w: 3 },
  { id: "fan_breeze_140", name: "ANTARCTIC P14 PWM PST A-RGB", price: 7, strength: 1, w: 3 },
  { id: "starter_fan", name: "Cooler Maestro CycleFlow 120 LED", price: 7, strength: 1, w: 3 },
  { id: "fan_breeze_160", name: "LIAN LU LANCHILL 216 160 RGB", price: 7, strength: 1, w: 3 },
  { id: "fan_135", name: "Cooler Maestro CycleFlow 120 LED Legacy", price: 12.76, strength: 1.35, w: 3 },
  { id: "fan_pressure_160", name: "LIAN LU LANCHILL 216 160 RGB Performance", price: 14.72, strength: 1.45, w: 4 },
  { id: "fan_pressure_120", name: "LIAN LU OMNI FAN SL120 V2", price: 14.72, strength: 1.45, w: 4 },
  { id: "fan_pressure_140", name: "LIAN LU OMNI FAN SL140 V2", price: 14.72, strength: 1.45, w: 4 },
];

/** Armado de una PC modular: ids del catálogo + cantidades de RAM y ventiladores. */
export interface Parts {
  board: string; cpu: string; gpu: string; ram: string; ramQty: number; ssd: string;
  cooler: string; case: string; psu: string; fan: string; fanQty: number;
}

export interface Sealed {
  hs: number; w: number; temps: [number, number];
  /** Precios de cuidado propios; si falta, se calculan con el precio del sistema (§12.5). */
  care?: { cpuPaste: number; gpuPaste: number; fanClean: number; repair: number };
}

export interface Card {
  id: string; name: string; price: number; minIslandLevel: number;
  /** Máximo por isla (Grain, Pebble, Seed, Sprout: 1). */
  limit: number | null;
  parts?: Parts; sealed?: Sealed;
}

export const CARDS: Card[] = [
  { id: "grain", name: "Grain", price: 1, minIslandLevel: 1, limit: 1,
    sealed: { hs: 0.25, w: 5, temps: [44.8, 42.8], care: { cpuPaste: 0.01, gpuPaste: 0.01, fanClean: 0.01, repair: 0.02 } } },
  { id: "pebble", name: "Pebble", price: 5, minIslandLevel: 1, limit: 1,
    sealed: { hs: 1.5, w: 20, temps: [45, 43], care: { cpuPaste: 0.05, gpuPaste: 0.05, fanClean: 0.04, repair: 0.1 } } },
  { id: "seed", name: "Seed", price: 25, minIslandLevel: 1, limit: 1,
    parts: { board: "retro_board_775", cpu: "retro_cpu_q9650", gpu: "gpu_hd_5770", ram: "retro_ram_ddr2_2gb", ramQty: 4, ssd: "ssd_legacy_64gb", cooler: "retro_cooler_tower", case: "retro_case_beige", psu: "retro_psu_100", fan: "retro_fan_92", fanQty: 1 } },
  { id: "sprout", name: "Sprout", price: 50, minIslandLevel: 1, limit: 1,
    parts: { board: "retro_board_775", cpu: "retro_cpu_q9650", gpu: "gpu_gtx_560_ti", ram: "retro_ram_ddr2_2gb", ramQty: 4, ssd: "ssd_legacy_64gb", cooler: "retro_cooler_tower", case: "retro_case_beige", psu: "psu_legacy_150", fan: "retro_fan_92", fanQty: 1 } },
  { id: "sapling", name: "Sapling", price: 100, minIslandLevel: 1, limit: null,
    parts: { board: "retro_board_775", cpu: "retro_cpu_q9650", gpu: "gpu_hd_7850", ram: "retro_ram_ddr2_2gb", ramQty: 4, ssd: "ssd_legacy_64gb", cooler: "retro_cooler_tower", case: "retro_case_beige", psu: "psu_legacy_150", fan: "retro_fan_92", fanQty: 1 } },
  { id: "fern", name: "Fern", price: 250, minIslandLevel: 1, limit: null,
    parts: { board: "legacy_board_1155", cpu: "legacy_cpu_i5_2500k", gpu: "gpu_legacy_gtx_1050_ti", ram: "ram_legacy_4gb", ramQty: 1, ssd: "ssd_legacy_64gb", cooler: "cooler_legacy_air", case: "retro_case_beige", psu: "psu_legacy_150", fan: "retro_fan_92", fanQty: 1 } },
  { id: "grove", name: "Grove", price: 500, minIslandLevel: 1, limit: null,
    parts: { board: "legacy_board_h61", cpu: "legacy_cpu_i5_2500k", gpu: "starter_gpu", ram: "ram_legacy_4gb", ramQty: 1, ssd: "ssd_legacy_64gb", cooler: "cooler_legacy_air", case: "retro_case_beige", psu: "psu_legacy_150", fan: "retro_fan_92", fanQty: 2 } },
  { id: "cedar", name: "Cedar", price: 1000, minIslandLevel: 1, limit: null,
    parts: { board: "board_glacier", cpu: "cpu_amd_7600", gpu: "starter_gpu", ram: "ram_lumen_dimm", ramQty: 4, ssd: "starter_ssd", cooler: "starter_cooler", case: "case_horizon", psu: "starter_psu", fan: "starter_fan", fanQty: 2 } },
  { id: "mac_mini", name: "Mack mini M4 Pro", price: 1173.3, minIslandLevel: 1, limit: null,
    sealed: { hs: 145, w: 65, temps: [47, 45] } },
  { id: "redwood", name: "Redwood", price: 2500, minIslandLevel: 1, limit: null,
    parts: { board: "board_glacier", cpu: "cpu_amd_9600x", gpu: "gpu_rtx_4080_super", ram: "ram_ddr5_48_6000_dimm", ramQty: 2, ssd: "ssd_glacier", cooler: "starter_cooler", case: "case_aurora", psu: "psu_snow", fan: "starter_fan", fanQty: 4 } },
  { id: "canopy", name: "Canopy", price: 5000, minIslandLevel: 1, limit: null,
    parts: { board: "board_trx50", cpu: "cpu_tr_9970x", gpu: "gpu_rtx_5080", ram: "ram_ddr5_16_5200_dimm", ramQty: 2, ssd: "starter_ssd", cooler: "cooler_xe360_tr5", case: "case_meshify_xl", psu: "psu_snow_600", fan: "starter_fan", fanQty: 5 } },
  { id: "sequoia", name: "Sequoia", price: 10000, minIslandLevel: 2, limit: null,
    parts: { board: "starter_board", cpu: "cpu_amd_7700", gpu: "gpu_rtx_pro_6000", ram: "ram_ddr5_32_5600_dimm", ramQty: 2, ssd: "starter_ssd", cooler: "starter_cooler", case: "case_apex", psu: "psu_snow_600", fan: "fan_135", fanQty: 3 } },
  { id: "hyperion", name: "Hyperion", price: 15000, minIslandLevel: 2, limit: null,
    parts: { board: "board_trx50", cpu: "cpu_tr_9980x", gpu: "gpu_rtx_pro_6000", ram: "ram_rdimm_64_6400", ramQty: 4, ssd: "ssd_9100_pro", cooler: "cooler_xe360_tr5", case: "case_meshify_xl", psu: "psu_snow_600", fan: "fan_135", fanQty: 6 } },
];

/** Curva de eficiencia: valor = K·parts_hs − LAM·watts → multiplicador (§12.1). */
export const CURVE = {
  k: 7.959975,
  lam: 0.594,
  top: 1.4,
  points: [
    [19.53, 1], [44.5, 1.0433], [93.79, 1.0867], [241.67, 1.144], [494.2, 1.1873],
    [984.13, 1.2307], [2483.21, 1.288], [4973.84, 1.3313], [9982.06, 1.3746], [14985, 1.4],
  ] as [number, number][],
};

export const RAM_LEGACY_ANCHORS: [number, number][] = [[2, 1], [4, 2], [8, 4], [16, 6]];

export const HEAT = {
  baseC: 43, pcCPerW: 0.043, cpuC: 6.5, cpuRefW: 35, gpuC: 9, gpuRefW: 75,
  fanBase: 0.7, fanGain: 2, dustyFlow: 0.25, pasteRiseC: 20, sealedDustRiseC: 12,
  throttleC: 70, lossPerC: 1.2, maxLossPct: 30, floorPct: 50, wearMaxPct: 15, wornPct: 5,
  clocks: { cpuPaste: 72, gpuPaste: 96, fan: 48, hardware: 336 },
  autoPastePct: 80,
};

export const CARE_PRICES = {
  pasteMin: 0.25, pastePct: 0.2, fanMin: 0.2, fanPcPct: 0.01, repairMin: 0.1, repairPct: 2,
};

export const USD_PER_KWH = 0.55;
export const PSU_RESERVE = 1.15;
export const HALL1_HS_CAP = 900;
export const MAX_DESKS = 8;

/** Niveles de energía: capacidad (W), precio base, minutos de builder. */
export const POWER_LEVELS = [
  { cap: 400, base: 0, min: 0 }, { cap: 475, base: 5, min: 15 }, { cap: 575, base: 5, min: 20 },
  { cap: 725, base: 5, min: 25 }, { cap: 900, base: 5, min: 30 }, { cap: 1125, base: 12, min: 40 },
  { cap: 1375, base: 12, min: 50 }, { cap: 1675, base: 12, min: 60 }, { cap: 2000, base: 12, min: 70 },
  { cap: 2375, base: 12, min: 80 }, { cap: 2800, base: 30, min: 90 }, { cap: 3250, base: 30, min: 100 },
  { cap: 3725, base: 30, min: 110 }, { cap: 4250, base: 30, min: 120 },
];
export const POWER_PER_100 = 1;

/** Parcelas 1..8: nivel de isla que piden, minutos de builder. La 1 es gratis. */
export const PLOTS = [
  { needIsland: 1, min: 0 }, { needIsland: 1, min: 15 }, { needIsland: 2, min: 30 },
  { needIsland: 3, min: 60 }, { needIsland: 4, min: 120 }, { needIsland: 6, min: 240 },
  { needIsland: 8, min: 480 }, { needIsland: 10, min: 960 },
];
export const PLOT_BASE = 5;
export const PLOT_PER_100 = 1;

/** Niveles de isla 1..11: precio, parcelas abiertas que piden, minutos y bonus acumulado (%). */
export const ISLAND_LEVELS = [
  { base: 0, per100: 0, needPlots: 1, min: 0, bonus: 0 },
  { base: 5, per100: 1.5, needPlots: 2, min: 30, bonus: 6 },
  { base: 10, per100: 1.5, needPlots: 3, min: 45, bonus: 12 },
  { base: 3, per100: 1.5, needPlots: 4, min: 60, bonus: 15 },
  { base: 3, per100: 1.5, needPlots: 5, min: 75, bonus: 18 },
  { base: 3, per100: 1.5, needPlots: 5, min: 90, bonus: 21 },
  { base: 3, per100: 1.5, needPlots: 6, min: 105, bonus: 24 },
  { base: 3, per100: 1.5, needPlots: 6, min: 120, bonus: 27 },
  { base: 3, per100: 1.5, needPlots: 7, min: 135, bonus: 30 },
  { base: 3, per100: 1.5, needPlots: 7, min: 150, bonus: 33 },
  { base: 3, per100: 4.5, needPlots: 8, min: 165, bonus: 36 },
];

/** Combo por cantidad de PCs matched (índice = cantidad), en %. */
export const COMBO_PCT = [0, 0, 6, 12, 18, 24, 30, 36, 48];
export const MATCH_MIN_HS = 5;
export const MATCH_SHARE = 0.25;
