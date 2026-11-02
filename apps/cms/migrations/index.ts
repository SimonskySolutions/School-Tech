import * as migration_20261102_120451_initial from './20261102_120451_initial';

export const migrations = [
  {
    up: migration_20261102_120451_initial.up,
    down: migration_20261102_120451_initial.down,
    name: '20261102_120451_initial',
  },
];
