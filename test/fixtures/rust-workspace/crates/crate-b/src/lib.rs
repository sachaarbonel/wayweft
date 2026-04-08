use crate_a::add;

pub fn double_add(a: i32, b: i32) -> i32 {
    add(a, b) + add(a, b)
}

pub fn check_flag(value: i32, flag: bool) -> &'static str {
    if flag {
        if value > 0 {
            "positive and flagged"
        } else {
            "non-positive and flagged"
        }
    } else {
        "not flagged"
    }
}
