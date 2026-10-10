import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

/** Valida el código de jornada de la URL (JP-AAMMDD-HHMM-XXX) antes de consultar. */
@Injectable()
export class JornadaCodigoPipe implements PipeTransform<string, string> {
  private static readonly PATTERN = /^JP-[0-9]{6}-[0-9]{4}-[A-Z0-9]{3}$/;

  transform(value: string): string {
    if (!JornadaCodigoPipe.PATTERN.test(value ?? '')) {
      throw new BadRequestException('Código de jornada inválido');
    }
    return value;
  }
}
