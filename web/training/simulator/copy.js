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
    posM: { left: '35%',   top: '82%' },
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
    posM: { left: '2%',    top: '82%' },
    what: 'The most powerful uppercut in boxing. The rear hip and leg fire straight up and the fist rides that line into the chin — short distance, enormous force.',
    points: [
      'Drop the rear shoulder and bend the rear knee, then extend both into the punch.',
      'Keep the fist close to your own body: it travels up the centre, never around the outside.',
      'Chin stays down. A missed uppercut leaves you tall, square and easy to hit.'
    ],
    use: 'For an opponent who ducks, leans in, or drops his head after a combination. Body first to bring the hands down, then the chin.'
  },
  {
    id: 'elbow', code: '07', clip: 'elbow', hit: 'RightForeArm', joint: true,
    name: 'Rear', em: 'Elbow', tag: 'rear arm · close range',
    sub: 'no swing · all bone',
    pos: { left: '27%', top: '10%' },
    posM: { left: '2%',  top: '75%' },
    what: 'The elbow is the shortest power shot in fighting. From the guard the rear arm turns over and the point of the elbow drives straight through where a hook would have to travel — nothing else in boxing arrives that fast from that range.',
    points: [
      'Turn the rear heel out as the arm comes through: the elbow rides the hip, not the shoulder.',
      'Keep the glove against your own chest — a wide elbow becomes a slap and telegraphs for a week.',
      'Strike with the point of the bone, not the forearm; the hand stays relaxed so the elbow is the hard part.'
    ],
    use: 'At clinch range, coming out of a slip, or against anyone who steps in behind his own punches. It opens cuts faster than any punch in the sport.'
  },
  {
    id: 'knee', code: '08', clip: 'knee', hit: 'RightLeg', joint: true,
    name: 'Rear', em: 'Knee', tag: 'rear leg · clinch range',
    sub: 'the body shot nobody blocks',
    pos: { left: '52%', top: '20%' },
    posM: { left: '35%', top: '75%' },
    what: 'A knee is a punch thrown with the biggest bone in your body. The rear leg lifts, the hip drives forward and up, and the strike lands with the point of the knee while both hands pull the target into it.',
    points: [
      'Step the lead foot out slightly so the knee travels straight up the middle, not across.',
      'Drive the hip through the target and pull the man down into it with both hands — the knee meets him halfway.',
      'Chin tucked and hands high: a knee that misses leaves you on one leg in punching range.'
    ],
    use: 'Clinch range and the body. It is the classic answer to a fighter who ties you up, and the reason strikers keep one hand free when they close the distance.'
  },
  {
    id: 'jab-cross', code: '09', clip: 'jab-cross', hit: 'LeftHand',
    boneList: ['LeftHand', 'RightHand'], multi: true,
    name: 'Jab', em: 'Cross', tag: 'two beats · the one-two',
    sub: 'the first combination anyone learns',
    pos: { left: '80%', top: '12%' },
    posM: { left: '68%', top: '75%' },
    what: 'The one-two: a jab to take the range and a cross down the same line before the guard comes back. Two punches, one movement — the jab opens the door and the rear hand walks through it.',
    points: [
      'Do not reset between them: the lead hand comes back as the rear hand goes out, so there is never a gap.',
      'The cross turns off the rear foot; if the heel stays down the second punch is only an arm.',
      'Throw both on the same line so the second arrives before the first has been answered.'
    ],
    use: 'Every exchange starts here. It scores, it measures distance, and it forces a reaction you can read for the third punch.'
  },
  {
    id: 'combo1', code: '10', clip: 'combo1', hit: 'LeftHand',
    boneList: ['LeftHand', 'RightHand'], multi: true,
    name: 'Combo', em: 'One', tag: 'four beats · tight hands',
    sub: 'short punches, no reset',
    pos: { left: '83%', top: '32%' },
    posM: { left: '68%', top: '82%' },
    what: 'A tight four-punch combination thrown from punching range without ever leaving the pocket. Nothing swings wide, the hands come back to the chin between shots, and the last punch lands where the first one started.',
    points: [
      'Stay in stance: the feet turn, the hips turn, and the shoulders never square up for longer than one punch.',
      'Breathe out on each shot — a combination held in the lungs runs out of speed by the third punch.',
      'Finish every combination in guard. The last punch is the one people get hit with on the way out.'
    ],
    use: 'When you are already inside and the other man is covering up. Judges score the cleaner, more numerous work — this is how you take a round without one big shot.'
  },
  {
    id: 'combo2-knee', code: '11', clip: 'combo2-knee', hit: 'RightHand',
    boneList: ['LeftHand', 'RightHand', 'RightLeg'], multi: true,
    name: 'Combo', em: 'Two · Knee', tag: 'long sequence · knee finish',
    sub: 'hands, then the knee',
    pos: { left: '62%', top: '64%' },
    posM: { left: '2%',  top: '89%' },
    what: 'A long combination that starts as boxing and finishes as clinch work: the hands bring the guard up and the head down, then the rear knee comes through the middle to the body.',
    points: [
      'The punches are the setup, not the point — aim them at the guard to make the man cover, not to knock him out.',
      'As the last punch lands the lead hand takes the head and the rear leg is already loaded.',
      'Knee up the centre and pull him into it; never lean back to make room for the knee.'
    ],
    use: 'The bridge between striking and the clinch — the moment a boxer covers up at close range, the knee is already free.'
  },
  {
    id: 'combo2-elbow', code: '12', clip: 'combo2-elbow', hit: 'RightHand',
    boneList: ['LeftHand', 'RightHand', 'RightForeArm'], multi: true, travel: true,
    name: 'Combo', em: 'Two · Elbow', tag: 'long sequence · elbow finish',
    sub: 'walk him down, then cut him',
    pos: { left: '58%', top: '76%' },
    posM: { left: '40%', top: '89%' },
    what: 'The walking version of the same idea: the combination presses forward behind the jab and the cross, and closes with the rear elbow once the distance is gone entirely.',
    points: [
      'Every punch buys a step: land, step, land again — do not reach with the hands for distance your feet have not covered.',
      'Save the elbow for the moment he is covering: it comes from the hip, not from a swing.',
      'Cut the angle as the elbow lands, so you exit on the side he is not looking at.'
    ],
    use: 'Against a fighter who backs up in a straight line. The pressure of the punches is what makes the elbow land — the strike itself is only the last ten centimetres.'
  }
];

export const MOVE_BY_ID = Object.fromEntries(MOVES.map((m) => [m.id, m]));
