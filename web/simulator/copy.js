/**
 * Heavy-bag lab — copy deck.
 * Every entry maps to one animation clip in media/glb/boxer-man.glb.
 * `hit` is the hand that lands; the impact frame is measured at runtime.
 * `pos` / `posM` are the node positions (desktop / phone) — deliberately irregular.
 */

export const MOVES = [
  {
    id: 'guard', code: '00', clip: 'guard', loop: true,
    name: 'Orthodox', em: 'Guard', tag: 'stance',
    sub: 'left hand leads · right hand loads',
    node: { ico: '⌂' },
    pos:  { left: '27.5%', top: '66%' },
    posM: { left: '6%',    top: '15%' },
    what: 'Everything in boxing starts from here. In the orthodox stance the left foot and left hand lead, the stronger rear side sits behind them, and both gloves stay between your chin and his fists.',
    points: [
      'Left foot forward, right foot back, feet about shoulder-width apart, knees soft — never locked.',
      'Lead glove a hand’s width in front of the chin, rear glove tucked at the jaw, elbow tight against the ribs.',
      'Chin down, eyes over the top of the gloves, weight even; the rear heel stays just light enough to pivot.'
    ],
    use: 'A guard is not a pose. It is the position every punch leaves from and returns to — a hand that drops is a target that stays open.'
  },
  {
    id: 'jab', code: '01', clip: 'jab', hit: 'LeftHand',
    name: 'Jab', em: 'Jab', tag: 'lead hand · straight',
    sub: 'speed · distance · the setup',
    pos: { left: '41%', top: '14.5%' },
    posM: { left: '7%', top: '31%' },
    what: 'The lead-hand straight — the fastest punch in the sport. No wind-up and almost no tell: the fist leaves the guard and returns on the same line.',
    points: [
      'Push off the ball of the lead foot; the shoulder turn throws the punch, the arm only steers it.',
      'Snap it out and pull it straight back — the hand never drops below the chin on the way home.',
      'The rear hand stays glued to the jaw: you are still covered while the lead hand works.'
    ],
    use: 'The jab measures distance, blinds the guard, and sets up every punch behind it. It wins rounds by itself — and it tells you what your opponent does when something comes at his face.'
  },
  {
    id: 'cross', code: '02', clip: 'cross', hit: 'RightHand',
    name: 'Cross', em: 'Cross', tag: 'rear hand · straight',
    sub: 'the first real power shot',
    pos: { left: '63%', top: '9%' },
    posM: { left: '38%',   top: '20%' },
    what: 'The rear-hand straight, and the punch that ends most fights. The power is built on the floor: rear foot, hip, then shoulder, with the fist arriving last.',
    points: [
      'Pivot the rear heel outward and drive the hip through — if the arm lands first, the punch is only an arm.',
      'The lead hand comes back to the chin as the cross fires. It is a trade, not a gift.',
      'Chin behind the lead shoulder, then recover the hand straight back to guard along the same line.'
    ],
    use: 'Straight lines travel the shortest path to the target. Throw it when the jab has pulled the guard apart, or as the finisher of every 1-2.'
  },
  {
    id: 'lead-hook', code: '03', clip: 'lead-hook', hit: 'LeftHand',
    name: 'Lead', em: 'Hook', tag: 'lead hand · horizontal',
    sub: 'around the guard, not through it',
    pos: { left: '84.5%', top: '27%' },
    posM: { left: '67%',   top: '29%' },
    what: 'A short horizontal arc from the lead hand that goes around a high guard instead of trying to break through it. The elbow stays bent — this is a swing with structure, not a haymaker.',
    points: [
      'Elbow up at shoulder height, forearm roughly parallel to the floor: a right angle, not a wide loop.',
      'Rotate the hips and torso and let the arm keep its shape; the body throws it, the arm just travels.',
      'Rear hand stays high — a hook is the punch an opponent most likes to counter with.'
    ],
    use: 'The answer to a tight high guard, and to anyone who keeps slipping your straight punches. Short range, short path, lands where you cannot see it coming.'
  },
  {
    id: 'rear-hook', code: '04', clip: 'rear-hook', hit: 'RightHand',
    name: 'Rear', em: 'Hook', tag: 'rear hand · horizontal',
    sub: 'the heaviest arc you own',
    pos: { left: '85%', top: '53%' },
    posM: { left: '76%',   top: '41%' },
    what: 'The heaviest hook in the box. The whole rear side — foot, hip, shoulder — rotates behind the fist, which is why it hurts and why it leaves you open for a beat longer.',
    points: [
      'Rear heel turns out hard; the hip leads the shoulder, and the shoulder leads the fist.',
      'Stay compact. A wide hook is a telegraph, and it turns your chest square to the target.',
      'The punch finishes where the jaw is, not past it — then the hand comes straight back.'
    ],
    use: 'Close range, once the other man is already hurt, or when he circles into your rear hand. Land it and the fight usually changes shape.'
  },
  {
    id: 'lead-uppercut', code: '05', clip: 'lead-uppercut', hit: 'LeftHand',
    name: 'Lead', em: 'Uppercut', tag: 'lead hand · vertical',
    sub: 'up through the middle',
    pos: { left: '76%', top: '80%' },
    posM: { left: '56%',   top: '53%' },
    what: 'A short vertical punch from the lead side that comes up through the middle of a high guard. It is the only punch that attacks from underneath.',
    points: [
      'Dip the lead shoulder and knee slightly, then drive up — the legs supply the punch, not the arm.',
      'Palm up, elbow in close, fist travelling straight up the centre line under the chin.',
      'Do not lean back to load it: either the target comes to you, or you step in with it.'
    ],
    use: 'Splits a peek-a-boo guard, punishes anyone who leans their head past their lead foot, and is the natural follow-up after a hook has brought the guard down.'
  },
  {
    id: 'rear-uppercut', code: '06', clip: 'rear-uppercut', hit: 'RightHand',
    name: 'Rear', em: 'Uppercut', tag: 'rear hand · vertical',
    sub: 'the finisher from below',
    pos: { left: '46%', top: '86%' },
    posM: { left: '27%',   top: '45%' },
    what: 'The most powerful uppercut in boxing. The rear hip and leg fire straight up and the fist rides that line into the chin — short distance, enormous force.',
    points: [
      'Drop the rear shoulder and bend the rear knee, then extend both into the punch.',
      'Keep the fist close to your own body: it travels up the centre, never around the outside.',
      'Chin stays down. A missed uppercut leaves you tall, square and easy to hit.'
    ],
    use: 'For an opponent who ducks, leans in, or drops his head after a combination. Body first to bring the hands down, then the chin.'
  }
];

export const MOVE_BY_ID = Object.fromEntries(MOVES.map((m) => [m.id, m]));
