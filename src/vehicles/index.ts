import { PLANES, PlaneStats } from './plane';
import { HELIS, HeliStats } from './heli';
import { VehiclePhysics } from './vehicle';
import { PlanePhysics } from '../physics/planePhysics';
import { HeliPhysics } from '../physics/heliPhysics';

export type VehicleStats = PlaneStats | HeliStats;

/** Alle Fluggeräte, sortiert nach Preis. */
export const VEHICLES: VehicleStats[] = [...PLANES, ...HELIS].sort((a, b) => a.price - b.price);

export function getVehicle(id: string): VehicleStats {
  return VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];
}

export function createPhysics(stats: VehicleStats): VehiclePhysics {
  return stats.kind === 'heli' ? new HeliPhysics(stats) : new PlanePhysics(stats);
}

/** Shop-Extras: wirken auf alle Fluggeräte. */
export interface Upgrade {
  id: string;
  name: string;
  description: string;
  price: number;
}

export const UPGRADES: Upgrade[] = [
  { id: 'magnet', name: '🧲 Münzmagnet', description: 'Münzen werden aus größerer Entfernung eingesammelt.', price: 120 },
  { id: 'gold', name: '✨ Goldlackierung', description: 'Dein Fluggerät glänzt golden.', price: 200 },
  { id: 'turbo', name: '🚀 Turbo', description: 'Mehr Schub: alle Fluggeräte werden etwa 12 % schneller.', price: 350 },
];

/** Werte mit eingeschaltetem Turbo. */
export function withTurbo<T extends VehicleStats>(stats: T): T {
  if (stats.kind === 'heli') return { ...stats, maxSpeed: stats.maxSpeed * 1.12, climbRate: stats.climbRate * 1.2 };
  return { ...stats, maxSpeed: stats.maxSpeed * 1.12, thrust: stats.thrust * 1.25 };
}
