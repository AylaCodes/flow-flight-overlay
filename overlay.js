// ---- API function shorthands
let get = this.$api.variables.get,
    get_airport = this.$api.airports.find_airport_by_icao;

let ds_export = this.$api.datastore.export,
    ds_import = this.$api.datastore.import;

// ---- Script variables
const VERSION = "0.13.9";

const SIMBRIEF_URL = "https://www.simbrief.com/api/xml.fetcher.php?username=";

const BOX = "checkbox",
      TXT = "text";

let container = null,
    var_list = null,
    type_label = null,
    registration_label = null,
    iata_label = null,
    origin_label = null,
    destination_label = null,
    distance_label = null,
    rules_label = null,
    network_label = null,
    airspeed_label = null,
    vertspeed_label = null,
    vs_icon = null,
    altitude_label = null,
    heading_label = null,
    wind_label = null,
    wind_icon = null,
    oat_label = null,
    oat_icon = null,
    custom_label = null,
    custom_icon = null;

let label_list = null,
    itext_list = null,
    icon_list = null;

let enabled_items = [],
    disabled_items = [];

// Global flight variables
let metric = false;
let target_airport = null;
let ap_lat = null;
let ap_lon = null;
let distance = "---";
let relative_wind = 0;
let wind_speed = 0;

/*
    Time since last SimBrief refresh.
    Setting this to "now" upon script load will prevent sending bad/unwanted requests
    on the first load of the script.
*/
let sb_refresh_timer = Date.now();

// ---- Helper functions
function ignore_type_error(e) {
    // Ignore harmless TypeError on hot reloads when data isn't available fast enough
    if (e instanceof TypeError) {} else { throw e; }
}

function clamp(number, min, max) {
    return Math.min(Math.max(number, min), max);
}

function resize_ui(store) {
    if (!itext_list || !icon_list || !label_list) { return; }

    label_list.forEach((label) => {
        label.style.fontSize = Math.round(store.font_size * 0.75) + "px";
    });
    itext_list.forEach((itext) => {
        itext.style.fontSize = store.font_size + "px";
    });
    icon_list.forEach((icon) => {
        icon.style.width = store.font_size + "px";
        icon.style.height = store.font_size + "px";
    });
}

function scroll_handler(store, event) {
    // handle wheel scroll to change UI size
    event.deltaY < 0 ? store.font_size += 1 : store.font_size -= 1;
    store.font_size = clamp(store.font_size, 8, 128);
    ds_export(store);
    resize_ui(store);
}

function set_styles(store) {
    // Set custom element colors
    let vars_list = document.querySelector("#streamer_overlay_vars");
    let items = document.querySelectorAll("#streamer_overlay_vars > span");
    let icons = document.querySelectorAll(".streamer_overlay_mdi");
    let labels = document.querySelectorAll(".streamer_overlay_label");
    let itexts = document.querySelectorAll(".streamer_overlay_itext");

    vars_list.style.backgroundColor = store.color_wrapper;

    if (store.outline_text) {
        vars_list.classList.add("streamer_overlay_outline");
    } else {
        vars_list.classList.remove("streamer_overlay_outline");
    }

    items.forEach((item) => {
        item.style.borderColor = store.color_outline;
        item.style.backgroundColor = store.color_background;
    });
    icons.forEach((icon) => {
        icon.style.filter = store.black_icons ? "invert(0%)" : "invert(100%)" ;
    });
    labels.forEach((label) => {
        label.style.color = store.color_text;
        if (store.outline_text) {
            label.classList.add("streamer_overlay_outline");
        } else {
            label.classList.remove("streamer_overlay_outline");
        }
    });
    itexts.forEach((itext) => {
        itext.style.color = store.color_text;
    });
}

function toggle_lists(item, value, enabled, disabled) {
    if (value) {
        enabled.push(item);
        disabled.splice(disabled.indexOf(item), 1);
    } else {
        disabled.push(item);
        enabled.splice(enabled.indexOf(item), 1);
    }
}

function load_views(enabled, disabled) {
    for (let item of disabled) {
        let elem = document.querySelector(`#streamer_overlay_${item}`);

        try {
            elem.style.display = "none";
        } catch (e) { ignore_type_error(e); }
    }

    for (let item of enabled) {
        let elem = document.querySelector(`#streamer_overlay_${item}`);

        try {
            elem.style.display = "inline-flex";
        } catch (e) { ignore_type_error(e); }
    }
}

function define_option(store, setting_name, input_type, ui_label, enabled, disabled) {
    // Define setting options for Flow
    return {
        type: input_type,
        label: ui_label,
        value: store[setting_name],

        changed: (value) => {
            store[setting_name] = value;

            if (setting_name.includes("_enabled") && setting_name != "simbrief_enabled") {
                let item_name = setting_name.split("_")[0];
                toggle_element(`#streamer_overlay_${item_name}`, value);
                toggle_lists(item_name, value, enabled, disabled);
            }

            set_styles(store);
            ds_export(store);
        }
    };
}

function load_enabled(store, enabled, disabled) {
    let settings = {};
    for (let item in store) {
        if (item == "overlay_toggle") { continue; }

        let enable_switch = typeof store[item] === "boolean";
        let name = item.split("_").join(" ").toUpperCase();

        settings[item] = define_option(
            store,
            item,
            enable_switch ? BOX : TXT,
            name,
            enabled,
            disabled
        );

        // Skip non-display items and setting values
        if (!enable_switch || item == "simbrief_enabled") {
            continue;
        }

        // Add values to the enabled/disabled lists
        let item_name = item.split("_")[0];

        if (store[item] == true) {
            enabled.push(item_name);
        } else {
            disabled.push(item_name);
        }
    }

    return settings;
}

function deg_to_rad(number) {
    // Convert degrees to radians
    return number * (Math.PI / 180);
}

function calc_distance(lat_a, lon_a, lat_b, lon_b) {
    // Calculate distance from two lat/long pairs in Nautical Miles
    let radius = 6371;

    let total_lat = lat_b - lat_a;
    let total_lon = lon_b - lon_a;
    total_lat = deg_to_rad(total_lat);
    total_lon = deg_to_rad(total_lon);

    let step_one =
        Math.sin(total_lat / 2) * Math.sin(total_lat / 2) +
        Math.cos(deg_to_rad(lat_a)) * Math.cos(deg_to_rad(lat_b)) *
        Math.sin(total_lon / 2) * Math.sin(total_lon / 2);

    let step_two = 2 * Math.atan2(Math.sqrt(step_one), Math.sqrt(1 - step_one));

    return (radius * step_two) / 1.852;
}

function pad_number(number, pad_amount, pad_char) {
    if (Math.sign(number) >= 0) {
        return number.toString().padStart(pad_amount, pad_char);
    } else {
        return "-" + Math.abs(number).toString().padStart(pad_amount, pad_char);
    }
}

function toggle_element(elem, value) {
    elem = document.querySelector(elem);
    elem.style.display = value ? "inline-flex" : "none";
}

function icon_toggle(value) {
    let icons = document.querySelectorAll(".streamer_overlay_mdi");
    let labels = document.querySelectorAll(".streamer_overlay_label");

    for (i = 0; i < icons.length; i++) {
        icons[i].style.display = value ? "inline-flex" : "none";
        labels[i].style.display = value ? "none" : "inline-flex";
    }
}

// ---- Configuration
this.store = {
    /*
    Each display item is a pair of <name> strings and <name>_enabled bools.
    This allows programmatically setting the `enabled_items` list easily.
    */
    overlay_toggle: true,
    metric_units: false,
    simbrief_enabled: false,
    simbrief_username: "USERNAME",
    type_enabled: false,
    type: "C172",
    registration_enabled: false,
    registration: "N172SP",
    iata_enabled: false,
    iata: "My Airline",
    origin_enabled: true,
    origin: "----",
    destination_enabled: true,
    destination: "----",
    distance_enabled: true,
    pad_distance: true,
    rules_enabled: false,
    rules: "VFR",
    network_enabled: false,
    network: "Multiplayer",
    airspeed_enabled: true,
    pad_airspeed: true,
    vertspeed_enabled: true,
    pad_vertspeed: true,
    altitude_enabled: true,
    pad_altitude: true,
    heading_enabled: true,
    wind_enabled: false,
    oat_enabled: false,
    oat_fahrenheit: false,
    custom_enabled: false,
    custom_icon: "note-text",
    custom: "Change me!",
    font_size: 23,
    overlay_bottom: false,
    display_icons: true,
    black_icons: false,
    outline_text: true,
    color_wrapper: "#00000090",
    color_outline: "#A0A0A0FF",
    color_background: "#00000090",
    color_text: "#FFFFFFFF"
};
ds_import(this.store);

// Take all config options and place them in a `settings` object
let settings = load_enabled(this.store, enabled_items, disabled_items);

settings.destination.changed = (value) => {
    this.store.destination = value;
    ds_export(this.store);
    target_airport = null;
};

settings.custom_enabled.changed = (value) => {
    this.store.custom_enabled = value;
    ds_export(this.store);
    toggle_element("#streamer_overlay_custom", value);
    toggle_element("#streamer_overlay_custom > .streamer_overlay_label", value);
    toggle_lists("custom", value, enabled_items, disabled_items);
};

settings.custom_icon.changed = (value) => {
    this.store.custom_icon = value;
    ds_export(this.store);
    custom_icon.src = `mdi/icons/${value}.svg`;
}

settings.font_size.changed = (value) => {
    this.store.font_size = clamp(value, 8, 128);
    ds_export(this.store);
    resize_ui(this.store);
};

settings.overlay_bottom.changed = (value) => {
    this.store.overlay_bottom = value;
    ds_export(this.store);
    container.style.alignSelf = (this.store.overlay_bottom ? "flex-end" : "flex-start");
};

settings.display_icons.changed = (value) => {
    this.store.display_icons = value;
    ds_export(this.store);
    icon_toggle(value);
};

settings_define(settings);

// ---- Events
run((event) => {
    this.store.overlay_toggle = !this.store.overlay_toggle;
    container.style.visibility = this.store.overlay_toggle ? "visible" : "hidden";

    ds_export(this.store);
});

scroll((event) => {
    // Click wheel to update SimBrief, instead of toggle overlay
    if (!this.store.simbrief_enabled || this.store.simbrief_username === "USERNAME") {
        return false;
    }

    // Only allow updating SimBrief once per 20s
    let now = Date.now();
    let time_since_refresh = (now - sb_refresh_timer) / 1000;

    if (time_since_refresh < 20) {
        return false;
    }

    // We're going to send a request to SimBrief, reset the timer
    sb_refresh_timer = now;

    fetch(`${SIMBRIEF_URL}${this.store.simbrief_username}&json=1`)
        .then(response => response.json())
        .then(data => {
            this.store.type = data.aircraft.icaocode;
            this.store.registration = data.aircraft.reg;
            this.store.origin = data.origin.icao_code;
            this.store.destination = data.destination.icao_code;
            this.store.iata = `${data.general.icao_airline} - ${data.atc.callsign}`;
            ds_export(this.store);
        });
});

state(() => {
    return this.store.overlay_toggle ? "mdi:airplane-check" : "mdi:airplane-off";
});

info(() => {
    if (!this.store.overlay_toggle) {
        return "Overlay disabled";
    } else {
        // Display countdown for SimBrief refresh if applicable
        if (this.store.simbrief_enabled) {
            if (this.store.simbrief_username === "USERNAME") {
                return "Please set SimBrief username";
            }

            let now = Date.now();
            let time = 20 - Math.round((now - sb_refresh_timer) / 1000);
            return time > 0 ? `SimBrief available in ${time}s` : "Overlay enabled";
        }
        return "Overlay enabled";
    }
});

style(() => {
    return this.store.overlay_toggle ? "active" : null;
});

loop_1hz(() => {
    metric = this.store.metric_units;

    let ac_lat = get("A:PLANE LATITUDE", "degrees");
    let ac_lon = get("A:PLANE LONGITUDE", "degrees");
    let ap_lat = null;
    let ap_lon = null;

    if (this.store.distance_enabled && this.store.destination != "----") {
        if (target_airport == null) {
            get_airport("streamer-overlay-lookup", this.store.destination, (results) => {
                target_airport = typeof results[0] != undefined ? results[0] : null;
            });
        }

        if (target_airport != null) {
            ap_lat = target_airport.lat;
            ap_lon = target_airport.lon;
            distance = Math.round(calc_distance(ac_lat, ac_lon, ap_lat, ap_lon));
        } else {
            distance = "---";
        }
    }

    // Don't calculate anything if the user is in slew mode
    if (get("A:IS SLEW ACTIVE", "number")) { return; };

    if (metric && distance != "---") { distance = Math.round(distance * 1.852); }

    let display_distance = distance
    if (distance != "---" && this.store.pad_distance) {
        display_distance = pad_number(distance, 4, "0");
    }

    // Update the rest of the labels
    let airspeed = Math.round(get("A:AIRSPEED INDICATED", metric ? "kph" : "knots"));
    if (airspeed < 5) { airspeed = 0; }
    if (this.store.pad_airspeed) { airspeed = pad_number(airspeed, 3, "0"); }

    let vertspeed = Math.round(get("A:VERTICAL SPEED", metric ? "m/s" : "ft/min"));
    if (this.store.pad_vertspeed) { vertspeed = pad_number(vertspeed, 4, "0"); }

    try {
        vs_threshold = metric ? 0.25 : 50;
        if (vertspeed <= -vs_threshold) {
            vs_icon.src = "mdi/icons/arrow-down-circle.svg";
        } else if (vertspeed >= vs_threshold) {
            vs_icon.src = "mdi/icons/arrow-up-circle.svg";
        } else {
            vs_icon.src = "mdi/icons/minus-circle.svg";
        }
    } catch (e) { ignore_type_error(e); }

    let altitude = Math.round(get("A:PLANE ALTITUDE", metric ? "meters" : "feet"));
    if (this.store.pad_altitude) { altitude = pad_number(altitude, 5, "0"); }

    let heading = pad_number(
        Math.round(get("A:PLANE HEADING DEGREES MAGNETIC", "degrees")), 3, "0"
    );

    let oat = Math.round(get("A:AMBIENT TEMPERATURE", "celsius"));

    try {
        if (oat <= 0) {
            oat_icon.src = "mdi/icons/snowflake-alert.svg";
        } else if (oat >= 37) {
            oat_icon.src = "mdi/icons/fire-alert.svg";
        } else {
            oat_icon.src = "mdi/icons/thermometer-lines.svg";
        }
    } catch (e) { ignore_type_error(e); }

    if (this.store.oat_fahrenheit) { oat = Math.round((oat * 1.8) + 32); }

    try {
        type_label.innerText = this.store.type;
        registration_label.innerText = this.store.registration;
        iata_label.innerText = this.store.iata;
        origin_label.innerText = this.store.origin;
        destination_label.innerText = this.store.destination;
        distance_label.innerText = `${display_distance}${metric ? "km" : "nm"}`;
        rules_label.innerText = this.store.rules;
        network_label.innerText = this.store.network;
        airspeed_label.innerText = `${airspeed}${metric ? "km/h" : "kt"}`;
        vertspeed_label.innerText = `${vertspeed}${metric ? "m/s" : "fpm"}`;
        altitude_label.innerText = `${altitude}${metric ? "m" : "ft"}`;
        heading_label.innerText = heading;
        oat_label.innerText = `${oat}${this.store.oat_fahrenheit ? "f" : "c"}`;
        custom_label.innerText = this.store.custom;
    } catch (e) { ignore_type_error(e); }
});

loop_15hz(() => {
    metric = this.store.metric_units;

    let wind_direction = Math.round(get("A:AMBIENT WIND DIRECTION", "degrees"));
    wind_speed = Math.round(get("A:AMBIENT WIND VELOCITY", metric ? "kph" : "knots"));
    let compass = get("A:PLANE HEADING DEGREES GYRO", "degrees");
    relative_wind = -Math.abs((360 + ((compass - wind_direction))) % 360) + 180;

    try {
        wind_label.innerText = `${wind_direction}@${wind_speed}${metric ? "km/h" : "kt"}`;
        wind_icon.style.transform = `rotate(${relative_wind}deg)`;
    } catch (e) { ignore_type_error(e); }
});

html_created((el) => {
    // Get referneces to the overlay elements
    container = el.querySelector("#streamer_overlay");
    var_list = el.querySelector("#streamer_overlay_vars");
    type_label = el.querySelector(
      "#streamer_overlay_type > .streamer_overlay_itext"
    );
    registration_label = el.querySelector(
      "#streamer_overlay_registration .streamer_overlay_itext"
    );
    iata_label = el.querySelector(
      "#streamer_overlay_iata .streamer_overlay_itext"
    );
    origin_label = el.querySelector(
      "#streamer_overlay_origin .streamer_overlay_itext"
    );
    destination_label = el.querySelector(
      "#streamer_overlay_destination .streamer_overlay_itext"
    );
    distance_label = el.querySelector(
      "#streamer_overlay_distance .streamer_overlay_itext"
    );
    rules_label = el.querySelector(
      "#streamer_overlay_rules .streamer_overlay_itext"
    );
    network_label = el.querySelector(
      "#streamer_overlay_network .streamer_overlay_itext"
    );
    airspeed_label = el.querySelector(
      "#streamer_overlay_airspeed .streamer_overlay_itext"
    );
    vertspeed_label = el.querySelector(
      "#streamer_overlay_vertspeed .streamer_overlay_itext"
    );
    vs_icon = el.querySelector(
        "#streamer_overlay_vertspeed > img"
    );
    altitude_label = el.querySelector(
      "#streamer_overlay_altitude .streamer_overlay_itext"
    );
    heading_label = el.querySelector(
      "#streamer_overlay_heading .streamer_overlay_itext"
    );
    wind_label = el.querySelector(
        "#streamer_overlay_wind .streamer_overlay_itext"
    );
    wind_icon = el.querySelector(
        "#streamer_overlay_wind > img"
    );
    oat_label = el.querySelector(
        "#streamer_overlay_oat .streamer_overlay_itext"
    );
    oat_icon = el.querySelector(
        "#streamer_overlay_oat > img"
    );
    custom_label = el.querySelector(
        "#streamer_overlay_custom .streamer_overlay_itext"
    );
    custom_icon = el.querySelector(
        "#streamer_overlay_custom > img"
    );

    label_list = el.querySelectorAll(".streamer_overlay_label");
    itext_list = el.querySelectorAll(".streamer_overlay_itext");
    icon_list = el.querySelectorAll(".streamer_overlay_mdi");

    el.onmousewheel = (event) => { scroll_handler(this.store, event); }

    resize_ui(this.store);
    set_styles(this.store);
    load_views(enabled_items, disabled_items);
    icon_toggle(this.store.display_icons);
    custom_icon.src = `mdi/icons/${this.store.custom_icon}.svg`;
});
