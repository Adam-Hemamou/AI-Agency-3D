import { describe, expect, it } from 'vitest';
import { isDatabaseUnavailable } from './errors.ts';

describe('isDatabaseUnavailable', () => {
  it('reconnaît l’erreur observée quand MySQL est arrêté (Prisma 7 + adaptateur MariaDB)', () => {
    // Forme réelle relevée en arrêtant le conteneur MySQL.
    const error = {
      name: 'PrismaClientKnownRequestError',
      code: 'P2039',
      meta: {
        driverAdapterError: {
          name: 'DriverAdapterError',
          cause: { code: 45028, cause: 'connect ECONNREFUSED ::1:3306' },
        },
      },
    };
    expect(isDatabaseUnavailable(error)).toBe(true);
  });

  it('reconnaît l’échec d’ouverture de transaction faute de connexion (MySQL coupé en cours de route)', () => {
    // Forme réelle relevée en arrêtant MySQL pendant que l'API tournait.
    expect(
      isDatabaseUnavailable({
        code: 'P2028',
        message: 'Transaction API error: Unable to start a transaction in the given time.',
      }),
    ).toBe(true);
    // Les autres erreurs P2028 (ex. : transaction expirée) restent des erreurs internes.
    expect(isDatabaseUnavailable({ code: 'P2028', message: 'Transaction already closed' })).toBe(
      false,
    );
  });

  it('reconnaît les codes Prisma de connexion', () => {
    expect(isDatabaseUnavailable({ code: 'P1001' })).toBe(true);
    expect(isDatabaseUnavailable({ name: 'PrismaClientInitializationError' })).toBe(true);
  });

  it('reconnaît une erreur réseau sous-jacente', () => {
    expect(
      isDatabaseUnavailable({
        code: 'P2039',
        meta: { driverAdapterError: { cause: { code: 1, cause: 'connect ETIMEDOUT' } } },
      }),
    ).toBe(true);
  });

  it('ignore les autres erreurs', () => {
    expect(isDatabaseUnavailable(new Error('bug'))).toBe(false);
    expect(isDatabaseUnavailable({ code: 'P2002' })).toBe(false);
    expect(isDatabaseUnavailable(null)).toBe(false);
  });
});
