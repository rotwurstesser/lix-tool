// App settings: one JSON object in <app data>/settings.json.

use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_KEEP_ALIVE: &str = "5m";

pub fn file(app_data: &Path) -> PathBuf {
    app_data.join("settings.json")
}

/// Reads all settings. A missing or broken file gives an empty object.
pub fn load(app_data: &Path) -> Map<String, Value> {
    fs::read_to_string(file(app_data))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

/// Merges the top-level keys of `patch` into the stored settings. A null value removes the key.
pub fn merge(app_data: &Path, patch: Map<String, Value>) -> Result<Map<String, Value>, String> {
    let mut all = load(app_data);
    for (key, value) in patch {
        if value.is_null() {
            all.remove(&key);
        } else {
            all.insert(key, value);
        }
    }
    fs::create_dir_all(app_data).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&Value::Object(all.clone())).map_err(|e| e.to_string())?;
    // Write a temp file first, so a crash never leaves half a file.
    let tmp = app_data.join("settings.json.tmp");
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, file(app_data)).map_err(|e| e.to_string())?;
    Ok(all)
}

pub fn keep_alive(app_data: &Path) -> String {
    load(app_data)
        .get("keepAlive")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_KEEP_ALIVE)
        .to_string()
}

/// Stored theme: "light", "dark" or "system" (the default, also for broken values).
pub fn theme(app_data: &Path) -> &'static str {
    match load(app_data).get("theme").and_then(Value::as_str) {
        Some("light") => "light",
        Some("dark") => "dark",
        _ => "system",
    }
}

/// Script that runs before the page, so the first paint has the right colours.
pub fn theme_script(theme: &str) -> String {
    let attr = if theme == "light" || theme == "dark" {
        format!("document.documentElement.setAttribute('data-theme','{theme}');")
    } else {
        "document.documentElement.removeAttribute('data-theme');".to_string()
    };
    format!("(function(){{try{{{attr}}}catch(e){{}}}})();")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merge_and_load_round_trip() {
        let dir = std::env::temp_dir().join(format!("lix-settings-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert!(load(&dir).is_empty());
        assert_eq!(keep_alive(&dir), "5m");

        let patch = json!({ "keepAlive": "15m", "setupStep": "model" });
        merge(&dir, patch.as_object().unwrap().clone()).unwrap();
        assert_eq!(keep_alive(&dir), "15m");

        assert_eq!(theme(&dir), "system");
        merge(&dir, json!({ "theme": "dark" }).as_object().unwrap().clone()).unwrap();
        assert_eq!(theme(&dir), "dark");
        merge(&dir, json!({ "theme": "purple" }).as_object().unwrap().clone()).unwrap();
        assert_eq!(theme(&dir), "system");

        let patch = json!({ "setupStep": null });
        let all = merge(&dir, patch.as_object().unwrap().clone()).unwrap();
        assert!(!all.contains_key("setupStep"));
        assert_eq!(load(&dir).get("keepAlive"), Some(&json!("15m")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn theme_script_sets_or_clears_the_attribute() {
        assert!(theme_script("dark").contains("setAttribute('data-theme','dark')"));
        assert!(theme_script("light").contains("'light'"));
        assert!(theme_script("system").contains("removeAttribute"));
        // Only the three fixed values reach the script, never stored text.
        assert!(theme_script("x');alert(1)//").contains("removeAttribute"));
    }
}
