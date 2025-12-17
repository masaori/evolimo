// AUTO-GENERATED compatibility shim - DO NOT EDIT

include!("dynamics.rs");

#[allow(dead_code)]
pub fn update_physics(
    state: &candle_core::Tensor,
    p_physics: &candle_core::Tensor,
    p_attributes: &candle_core::Tensor,
) -> candle_core::Result<candle_core::Tensor> {
    update_dynamics(state, p_physics, p_attributes)
}
