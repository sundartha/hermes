const NANP_PREFIX = "+1";
const AREA_CODE_LENGTH = 3;

const KEINE_HYPOTHESE = "";

const ZONE_EASTERN = "America/New_York";
const ZONE_CENTRAL = "America/Chicago";
const ZONE_MOUNTAIN = "America/Denver";
const ZONE_ARIZONA = "America/Phoenix";
const ZONE_PACIFIC = "America/Los_Angeles";
const ZONE_HAWAII = "Pacific/Honolulu";

const AREA_CODES_BY_ZONE = Object.freeze({
  [ZONE_EASTERN]: Object.freeze({
    NY: "212 646 332 917 718 347 929 516 631 914 845 518 315 838 607 585 716 680",
    NJ: "201 551 609 732 848 856 862 908 973",
    PA: "215 267 484 610 570 272 717 724 878 412 814",
    CT: "203 475 860 959",
    MA: "617 857 781 339 978 351 508 774 413",
    RI: "401",
    NH: "603",
    VT: "802",
    ME: "207",
    DE: "302",
    DC: "202",
    MD: "301 240 410 443 667",
    VA: "703 571 804 757 434 540 276",
    WV: "304 681",
    NC: "704 980 828 336 910 919 984 252",
    SC: "803 843 854 864",
    GA: "404 470 678 770 762 706 912 229 478",
    OH: "216 440 330 234 419 567 614 380 513 937 740",
    MI: "313 248 947 586 734 810 517 616 231 989",
    FL: "305 786 954 754 561 772 407 321 689 813 727 941 239 863 352 386 904",
  }),
  [ZONE_CENTRAL]: Object.freeze({
    IL: "312 773 872 224 847 630 331 708 815 779 217 309 618",
    WI: "414 262 608 715 534 920",
    MN: "612 651 763 952 218 320 507",
    IA: "515 319 563 641 712",
    MO: "314 636 573 660 816 417",
    AR: "501 479 870",
    LA: "504 225 337 318 985",
    MS: "601 769 662 228",
    AL: "205 659 251 256 938 334",
    TX: "214 469 972 945 817 682 713 281 832 346 210 726 512 737 361 254 940 903 430 936 979 409 806 325 432",
    OK: "405 918 539 580",
    NE: "402 531",
    KS: "913 316",
  }),
  [ZONE_MOUNTAIN]: Object.freeze({
    CO: "303 720 983 970 719",
    UT: "801 385 435",
    NM: "505 575",
    WY: "307",
    MT: "406",
  }),
  [ZONE_ARIZONA]: Object.freeze({ AZ: "602 480 623 520" }),
  [ZONE_PACIFIC]: Object.freeze({
    CA: "213 323 310 424 818 747 626 661 562 714 657 949 951 909 760 442 619 858 415 628 650 408 669 510 341 925 707 916 279 209 559 805 831 530",
    WA: "206 253 425 360 564 509",
    OR: "503 971",
    NV: "702 725",
  }),
  [ZONE_HAWAII]: Object.freeze({ HI: "808" }),
});

const SPOKEN_ZONE_NAME = Object.freeze({
  [ZONE_EASTERN]: "Eastern time",
  [ZONE_CENTRAL]: "Central time",
  [ZONE_MOUNTAIN]: "Mountain time",
  [ZONE_ARIZONA]: "Arizona time",
  [ZONE_PACIFIC]: "Pacific time",
  [ZONE_HAWAII]: "Hawaii time",
});

const AREA_CODE_SEPARATOR = " ";

const ZONE_BY_AREA_CODE = new Map(
  Object.entries(AREA_CODES_BY_ZONE).flatMap(([zone, jeStaat]) =>
    Object.values(jeStaat)
      .flatMap((vorwahlen) => vorwahlen.split(AREA_CODE_SEPARATOR))
      .map((vorwahl) => [vorwahl, zone]),
  ),
);

export function timezoneHypothesisForNumber(e164) {
  if (typeof e164 !== "string" || !e164.startsWith(NANP_PREFIX)) return KEINE_HYPOTHESE;
  const vorwahl = e164.slice(NANP_PREFIX.length, NANP_PREFIX.length + AREA_CODE_LENGTH);
  return ZONE_BY_AREA_CODE.get(vorwahl) || KEINE_HYPOTHESE;
}

export function spokenTimezoneName(zone) {
  return SPOKEN_ZONE_NAME[zone] || zone;
}
