pub mod universal_gravitation;

#[macro_export]
macro_rules! with_definition {
    ($name:expr, $callback:path) => {
        match $name.as_str() {
            "universal_gravitation" => { $callback!(crate::_gen::universal_gravitation) },
            _ => panic!("Unknown definition: {}", $name),
        }
    }
}
