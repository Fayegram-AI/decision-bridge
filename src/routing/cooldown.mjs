// A named group shares cooldowns only with other explicitly grouped targets.
export function cooldownKey(target) {
    return target.cooldownGroup === undefined ? `route:${target.id}` : `group:${target.cooldownGroup}`;
}
