// `core` no usa la librería DOM. `URL` existe en navegadores, Workers y Node,
// así que se declara aquí solo lo que el código necesita.
declare class URL {
  constructor(input: string);
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly pathname: string;
}
