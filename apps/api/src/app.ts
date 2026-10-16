import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { Auth } from './infrastructure/auth';
import { authRoutes } from './routes/auth';

export const AppLive = Layer.unwrap(
  Effect.gen(function* () {
    const auth = yield* Auth;

    return authRoutes.pipe(
      HttpRouter.provideRequest(Layer.succeed(Auth, auth))
    );
  })
);
