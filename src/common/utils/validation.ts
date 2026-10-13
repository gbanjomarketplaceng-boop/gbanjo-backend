import { HttpStatus, ValidationError, ValidationPipe } from "@nestjs/common";
import { AppException } from "../exceptions/app.exception";

const flatten = (errors: ValidationError[], parent = ""): Record<string, string> =>
  errors.reduce<Record<string, string>>((acc, e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) acc[path] = Object.values(e.constraints)[0];
    if (e.children?.length) Object.assign(acc, flatten(e.children, path));
    return acc;
  }, {});

/** Global ValidationPipe: strips unknown fields, transforms types, returns VALIDATION_FAILED with per-field errors. */
export const validationPipe = () =>
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => {
      const fields = flatten(errors);
      return new AppException(HttpStatus.BAD_REQUEST, "VALIDATION_FAILED", Object.values(fields)[0] ?? "Invalid request", { fields });
    },
  });
