use std::collections::HashMap;

/// A function with too many parameters (triggers too-many-params rule).
pub fn process(
    input: &str,
    flag: bool,
    max: usize,
    min: usize,
    offset: usize,
) -> String {
    if flag {
        format!("input={} max={} min={} offset={}", input, max, min, offset)
    } else {
        String::from("disabled")
    }
}

/// A deeply nested function (triggers deep-nesting rule).
pub fn classify(value: i32, threshold: i32) -> &'static str {
    if value > 0 {
        if value > threshold {
            if value > threshold * 2 {
                if value > threshold * 4 {
                    "very high"
                } else {
                    "high"
                }
            } else {
                "medium"
            }
        } else {
            "low"
        }
    } else {
        "negative"
    }
}

/// A function with a boolean parameter (triggers boolean-param rule).
pub fn render(label: &str, verbose: bool) -> String {
    if verbose {
        format!("[VERBOSE] {}", label)
    } else {
        label.to_string()
    }
}

/// A long function (triggers long-function rule if enough lines).
pub fn build_report(items: &[String]) -> HashMap<String, usize> {
    let mut counts = HashMap::new();
    for item in items {
        let entry = counts.entry(item.clone()).or_insert(0);
        *entry += 1;
    }
    let mut totals = HashMap::new();
    for (key, value) in &counts {
        if value > &1 {
            totals.insert(key.clone(), *value);
        }
    }
    let mut result = HashMap::new();
    for (key, value) in totals {
        if key.len() > 2 {
            result.insert(key, value);
        }
    }
    result
}
