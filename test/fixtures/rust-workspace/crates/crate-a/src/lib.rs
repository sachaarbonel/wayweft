pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

pub fn process_many(a: i32, b: i32, c: i32, d: i32, e: i32) -> i32 {
    if a > 0 {
        if b > 0 {
            if c > 0 {
                a + b + c + d + e
            } else {
                0
            }
        } else {
            0
        }
    } else {
        0
    }
}
