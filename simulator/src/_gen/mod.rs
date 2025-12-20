pub mod universal_gravitation;
pub mod universal_gravitation_fixed_capacity_grid;
pub mod example_fixed_capacity_grid;
pub mod example_conditional;

#[macro_export]
macro_rules! with_definition {
    ($name:expr, $callback:path) => {
        match $name.as_str() {
            "universal_gravitation" => { use $crate::_gen::universal_gravitation as def; $callback!(def) },
            "universal_gravitation_fixed_capacity_grid" => { use $crate::_gen::universal_gravitation_fixed_capacity_grid as def; $callback!(def) },
            "example_fixed_capacity_grid" => { use $crate::_gen::example_fixed_capacity_grid as def; $callback!(def) },
            "example_conditional" => { use $crate::_gen::example_conditional as def; $callback!(def) },
            _ => panic!("Unknown definition: {}", $name),
        }
    }
}
