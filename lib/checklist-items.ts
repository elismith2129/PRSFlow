export type ChecklistSection = { section: string; items: string[] }
export type StudioChecklist = { opening: ChecklistSection[]; closing: ChecklistSection[] }

export const CHECKLISTS: Record<string, StudioChecklist> = {

  // ─── PARAMOUNT ─────────────────────────────────────────────────────────────
  paramount: {
    opening: [
      {
        section: 'Building',
        items: [
          "If MGMT isn't in yet, unlock/unarm",
          "Check the closer's slack notes",
          'Open the blinds & turn on the lights',
          'Unlock the back doors',
          'Turn the TVs on in the office',
          'Leaf blow the alleyway, sidewalks, parking lots, patio and cleanup any trash/debris. Hose down patio area/benches, look out for bird droppings. FIRST THING after opening.',
        ],
      },
      {
        section: 'Control Rooms / Studios',
        items: [
          'Check console, racks and interior of studio for spills, burns/ash or damage. Take pictures and report any damages.',
          'Open rooms with sessions and stage properly.',
          'Live Rooms: Organize mic stands, center carpets, arrange gobos and active mic stand, turn on all lights and LEDs. Remove leftover items and return to storage.',
        ],
      },
      {
        section: 'Kitchen Area',
        items: [
          'Unload the clean dishes, check cleanliness including silverware (wipe watermarks)',
          'Check silverware count, report low amounts to MGMT',
          'Toss expired food, check cold water stock, arrange fridge items',
          'Break up ice and ensure ice buckets/scoops or tongs are ready',
          'Ensure a clean and stocked kitchen',
          'Unload clean laundry from dryer or transfer wet items to dryer as needed (replace C-sheets if needed)',
          'Complete stock inventory',
        ],
      },
      {
        section: 'Runs',
        items: [
          'Complete store run (and Rider if applicable)',
          'Complete office run (Wednesdays)',
          'Upload all run receipts to Ramp and file accordingly',
        ],
      },
      {
        section: 'Other',
        items: [
          'Do petty cash opening count, report any discrepancies',
          'Give the closer their start time',
        ],
      },
      {
        section: 'Before you leave',
        items: [
          'Write/send slack notes',
          'Tidy up office area, desk',
        ],
      },
    ],
    closing: [
      {
        section: 'Control Rooms / Studios',
        items: [
          'Check console, racks and interior of studio for spills, burns/ash or damage. Take pictures. Vacuum ash and Windex fader covers.',
          'Wipe credenzas with Windex (no Lysol wipes, they streak)',
          "All control rooms' ACs set to 75, cool, auto, schedule OFF — live room ACs OFF",
          'Vacuum floors and Swiffer hardwood',
          'Take out trash',
          'Shut TVs and cable boxes off, clean TV surface with microfiber cloth',
          'Restock supplies: Gaff/console tape, 6 of each colored pen, 6 sharp pencils, 3 of each colored sharpie, 3 of each colored ultra fine sharpie, 3 highlighters, 1 large post-it notes, 3 large notepads, 3 small notepads, 1 pair of scissors, Febreeze, earplugs, tissues, hand sanitizer, 3 extra toilet paper rolls in bathroom',
          'Sharpen pencils, set engineer pad, pen and pencil',
          'Put candles on charger',
          'Remove previous session items, straighten pillows, furniture, square off items',
          'Organize patch cables, mic stands, gobos, put away unused/extra equipment, cut the board',
          'Live Rooms: Put all mic stands in place, broken down, organized by size and make. Organize all gobos. Break down and put back guitar stands, keyboard stands, chairs, stools, music stands. DO NOT leave items in control room or pushed to side.',
        ],
      },
      {
        section: 'Building',
        items: [
          'Turn off all studio lights including lamps & LEDs (excluding: light outside shop door, outside MGMT door, outside Studio F)',
          'Vacuum hallways and Swiffer tile/wood floors',
          'Clear away visible dust & spider webs',
          'Empty all trash cans',
          'Empty vacuum bag (Sunday night only)',
          'Empty & clean all ashtrays (Windex, no Lysol)',
          'Tidy up & restock office area, desk (including waters)',
          'Wash necessary items, note if dry cycle is needed',
          'Charge leaf blower battery',
        ],
      },
      {
        section: 'Bathrooms',
        items: [
          'Clean counters & toilets',
          'Windex mirrors',
          'Sweep & mop floors',
          'Restock paper towels, toilet paper, Kleenex, supplies as needed',
        ],
      },
      {
        section: 'Kitchen Area',
        items: [
          'Sweep & Swiffer mop floors',
          'Load & run dishwasher',
          'Clean sink, counters, refrigerator, freezer, microwave, popcorn dispenser',
          'Clean tea kettle (heat small amount of vinegar, then wash with soap) and coffee maker',
          'Create fruit bowls for the next day',
          'Stock and tidy (bagels, jellies, straws, cups, fridge water etc.)',
          'Run the washing machine',
        ],
      },
      {
        section: 'Paperwork',
        items: [
          'Complete microphone inventory — report discrepancies. Email Inventory to Tom.',
          'Complete closing count for petty cash, report discrepancies',
          'Upload all run receipts to Ramp and file accordingly',
        ],
      },
      {
        section: 'Before you leave',
        items: [
          'Write/send slack notes',
          'Confirm the opener\'s start time. CHECK WITH MANAGEMENT BEFORE 12AM IF ANY UNCERTAINTY.',
          'Studio doors and back door deadbolted',
          'Camera screen, computer screen and office monitors are turned off',
          'Confirm Studio D & Studio F tenants have left the building',
          'Had cleaners?',
          'The alarm is set',
          'The front door is locked as you leave the building',
          'The gate is closed and locked (jumble numbers)',
        ],
      },
    ],
  },

  // ─── AMERAYCAN ─────────────────────────────────────────────────────────────
  ameraycan: {
    opening: [
      {
        section: 'Building',
        items: [
          "Check the closer's slack notes",
          'Un-forward the phones (Enter *73)',
          'Ensure front and back are unlocked',
          'Turn on the lights including hall LEDs',
          'Turn the TVs on and mute',
          'Leaf blow the alleyway, sidewalks, parking lot, patio and cleanup any trash/debris. Hose down patio area/benches, look out for bird droppings. FIRST THING after opening.',
          'Make sure the fountain is running & chlorinated, leaves & bugs removed, water topped off',
        ],
      },
      {
        section: 'Control Rooms / Studios',
        items: [
          'Check console, racks and interior of studio for spills, burns/ash or damage. Take pictures and report any damages.',
          'Open rooms with sessions and stage properly.',
          'Live Rooms: Organize mic stands, center carpets, arrange gobos and active mic stand, turn on all lights and LEDs. Remove leftover items and return to storage.',
        ],
      },
      {
        section: 'Kitchen Area',
        items: [
          'Unload the clean dishes, check cleanliness including silverware (wipe watermarks)',
          'Check silverware count, report low amounts to MGMT',
          'Toss expired food, check cold water stock, arrange fridge items',
          'Break up ice bags and ensure ice buckets/scoops or tongs are ready',
          'Ensure a clean and stocked kitchen',
        ],
      },
      {
        section: 'Runs',
        items: [
          'Complete store run (and Rider if applicable)',
          'Complete office run (Wednesdays)',
          'Upload all run receipts to Ramp and file accordingly (including expense sheets)',
        ],
      },
      {
        section: 'Other',
        items: [
          'Do petty cash opening count, report any discrepancies',
          'Give the closer their start time',
        ],
      },
      {
        section: 'Before you leave',
        items: [
          'Tidy up office area, desk',
          'Make sure machine rooms are locked',
          'Write/send slack notes',
        ],
      },
    ],
    closing: [
      {
        section: 'Building',
        items: [
          'Turn off all studio lights including lamps & LEDs',
          'Vacuum hallways and Swiffer tile/wood floors',
          'Clear away visible dust & spider webs',
          'Empty all trash cans',
          'Empty vacuum bag (Sunday night only)',
          'Empty & clean all ashtrays (Windex, no Lysol)',
          'Tidy up & restock office area, desk (including waters)',
          'Transfer blankets to ERS or PRS for wash (if used)',
          'Charge leaf blower battery',
        ],
      },
      {
        section: 'Control Rooms / Studios',
        items: [
          'Check console, racks and interior of studio for spills, burns/ash or damage. Take pictures. Vacuum ash and Windex fader covers.',
          'Wipe credenzas with Windex (no Lysol wipes, they streak)',
          "All control rooms' ACs set to 75, cool, auto, schedule OFF — live room ACs OFF",
          'Vacuum floors and Swiffer hardwood',
          'Take out trash',
          'Shut TVs and cable boxes off, clean TV surface with microfiber cloth',
          'Restock supplies: Gaff/console tape, 6 of each colored pen, 6 sharp pencils, 3 of each colored sharpie, 3 of each colored ultra fine sharpie, 3 highlighters, 1 large post-it notes, 3 large notepads, 3 small notepads, 1 pair of scissors, Febreeze, earplugs, tissues, hand sanitizer, 3 extra toilet paper rolls in bathroom',
          'Sharpen pencils, set engineer pad, pen and pencil',
          'Put candles on charger',
          'Remove previous session items, straighten pillows, furniture, square off items',
          'Organize patch cables, mic stands, gobos, put away unused/extra equipment, cut the board',
          'Live Rooms: Put all mic stands in place, broken down, organized by size and make. Organize all gobos. Break down and put back guitar stands, keyboard stands, chairs, stools, music stands.',
        ],
      },
      {
        section: 'Bathrooms',
        items: [
          'Clean counters & toilets',
          'Windex mirrors',
          'Sweep & mop floors',
          'Restock paper towels, toilet paper, Kleenex, supplies as needed',
        ],
      },
      {
        section: 'Kitchen Area',
        items: [
          'Sweep & Swiffer mop floors',
          'Load & run dishwasher',
          'Clean sink, counters, refrigerator, freezer, microwave',
          'Clean tea kettle (heat small amount of vinegar, then wash with soap) and coffee maker',
          'Create fruit bowls for the next day',
          'Stock and tidy (bagels, jellies, straws, cups, fridge water etc.)',
        ],
      },
      {
        section: 'Paperwork',
        items: [
          'Complete microphone inventory — report discrepancies. Email Inventory to Tom and to info@paramountrecording.com separately.',
          'Complete closing count for petty cash, report discrepancies',
          'Email to Paramount: Completed Session Invoices, Petty Cash Log, Stock Inventory List, Mic Inventory, Expense Sheets w/ receipts, slack notes',
          'Upload all run receipts to Ramp and file accordingly',
        ],
      },
      {
        section: 'Before you leave',
        items: [
          'Forward Phones (*72 then enter 323 465 4000 after dial tone)',
          'Write/send slack notes',
          "Confirm the opener's start time. CHECK WITH MANAGEMENT BEFORE 12AM IF ANY UNCERTAINTY.",
          'Studio doors and back door deadbolted',
          'Camera screen, computer screen and office monitors are turned off',
          'Had cleaners?',
          'The alarm is set',
          'The front door is locked as you leave the building',
          'The gate is closed and locked',
        ],
      },
    ],
  },

  // ─── ENCORE ────────────────────────────────────────────────────────────────
  encore: {
    opening: [
      {
        section: 'Building',
        items: [
          "Check the closer's slack notes",
          'Open the blinds & turn on the lights including hall LEDs',
          'Turn the TVs on',
          'Leaf blow the alleyway, sidewalks, parking lots, patio and cleanup any trash/debris. Hose down patio area/benches, look out for bird droppings. FIRST THING after opening.',
        ],
      },
      {
        section: 'Control Rooms / Studios',
        items: [
          'Check console, racks and interior of studio for spills, burns/ash or damage. Take pictures and report any damages.',
          'Open rooms with sessions and stage properly.',
        ],
      },
      {
        section: 'Kitchen Area',
        items: [
          'Unload the clean dishes, check cleanliness including silverware (wipe watermarks)',
          'Check silverware count, report low amounts to MGMT',
          'Toss expired food, check cold water stock, arrange fridge items',
          'Break up ice bags and ensure ice buckets/scoops or tongs are ready',
          'Ensure a clean and stocked kitchen',
          'Unload the clean laundry from the dryer (replace apartment sheets if needed)',
        ],
      },
      {
        section: 'Runs',
        items: [
          'Complete store run',
          'Complete office run (Wednesdays)',
          'Upload all run receipts to Ramp and file accordingly (including expense sheets)',
        ],
      },
      {
        section: 'Other',
        items: [
          'Do petty cash opening count, report any discrepancies',
          'Give the closer their start time',
        ],
      },
      {
        section: 'Before you leave',
        items: [
          'Tidy up office area, desk',
          'Write/send slack notes',
        ],
      },
    ],
    closing: [
      {
        section: 'Building',
        items: [
          'Turn off all studio lights including lamps & LEDs',
          'Vacuum hallways and Swiffer tile/wood floors',
          'Clear away visible dust & spider webs',
          'Empty all trash cans',
          'Empty vacuum bag (Sunday night only)',
          'Empty & clean all ashtrays',
          'Tidy up & restock office area, desk (including waters)',
          'Wash any necessary items and note in Slack if a dry cycle is needed',
          'Charge leaf blower battery',
          'Verify ERS B Roof Door is locked',
        ],
      },
      {
        section: 'Control Rooms / Studios',
        items: [
          'Check console, racks and interior of studio for spills, burns/ash or damage. Take pictures. Vacuum ash and Windex fader covers.',
          'Wipe credenzas with Windex (no Lysol wipes, they streak)',
          "All control rooms' ACs set to 75, cool, auto, schedule OFF — live room ACs OFF",
          'Vacuum floors and Swiffer hardwood',
          'Take out trash',
          'Shut TVs and cable boxes off, clean TV surface with microfiber cloth',
          'Restock supplies: Gaff/console tape, 6 of each colored pen, 6 sharp pencils, 3 of each colored sharpie, 3 of each colored ultra fine sharpie, 3 highlighters, 1 large post-it notes, 3 large notepads, 3 small notepads, 1 pair of scissors, Febreeze, earplugs, tissues, hand sanitizer, 3 extra toilet paper rolls in bathroom',
          'Sharpen pencils, set engineer pad, pen and pencil',
          'Put candles on charger',
          'Remove previous session items, straighten pillows, furniture, square off items',
          'Organize patch cables, mic stands, gobos, put away unused/extra equipment, cut the board',
        ],
      },
      {
        section: 'Bathrooms',
        items: [
          'Clean counters & toilets',
          'Windex mirrors',
          'Sweep & mop floors',
          'Restock paper towels, toilet paper, Kleenex, supplies as needed',
        ],
      },
      {
        section: 'Kitchen Area',
        items: [
          'Sweep & Swiffer mop floors',
          'Load & run dishwasher',
          'Clean sink, counters, refrigerator, coffee maker, microwave',
          'Clean tea kettle (heat small amount of vinegar, then wash with soap) and coffee maker',
          'Create fruit bowls for the next day',
          'Stock and tidy (bagels, jellies, straws, cups, fridge water etc.)',
        ],
      },
      {
        section: 'Paperwork',
        items: [
          'Complete microphone inventory — report discrepancies. Email Inventory to Tom and to info@paramountrecording.com separately.',
          'Complete closing count for petty cash, report discrepancies',
          'Email to Paramount: Completed Session Invoices, Petty Cash Log, Stock Inventory List, Mic Inventory, Expense Sheets w/ receipts, slack notes',
          'Upload all run receipts to Ramp and file accordingly',
        ],
      },
      {
        section: 'Before you leave',
        items: [
          'Write/send slack notes',
          "Confirm the opener's start time. CHECK WITH MANAGEMENT BEFORE 12AM IF ANY UNCERTAINTY.",
          'Studio doors deadbolted',
          'Camera screen, computer screen and office monitors are turned off',
          'Had cleaners?',
          'The alarm is set',
          'The front door is locked as you leave the building',
          'The gate is closed and locked as you leave the lot',
        ],
      },
    ],
  },

  // ─── TRACK ─────────────────────────────────────────────────────────────────
  track: {
    opening: [
      {
        section: 'Building',
        items: [
          'Leaf blow the alleyway, sidewalks, parking lot and clean any trash/debris. No leaves or debris in parking lot, under stairs, or on walkway to backhouse. FIRST THING.',
          'Check outside the lot in the alley and outside of gates for debris from the previous night',
          "Check the closer's slack notes",
          'Ensure fronts are unlocked',
          'Turn on the lights',
          'Turn the TVs on and mute',
        ],
      },
      {
        section: 'Control Rooms / Studios',
        items: [
          'Check console, racks and interior of studio for spills, burns/ash or damage. Take pictures and report any damages.',
          'Live Rooms: Organize mic stands, center carpets, arrange gobos and active mic stand, turn on all lights and LEDs. Remove leftover items and return to storage.',
          'Open rooms with sessions and stage properly.',
        ],
      },
      {
        section: 'Kitchen Area',
        items: [
          'Unload the clean dishes, check cleanliness including silverware (wipe watermarks)',
          'Check silverware count, report low amounts to MGMT',
          'Toss expired food, check cold water stock, arrange fridge items',
          'Break up ice bags and ensure ice buckets/scoops or tongs are ready',
          'Ensure a clean and stocked kitchen',
        ],
      },
      {
        section: 'Runs',
        items: [
          'Complete store run (and Rider if applicable)',
          'Complete office run (Wednesdays)',
          'Upload all run receipts to Ramp and file accordingly (including expense sheets)',
        ],
      },
      {
        section: 'Other',
        items: [
          'Do petty cash opening count, report any discrepancies',
          'Give the closer their start time',
        ],
      },
      {
        section: 'Before you leave',
        items: [
          'Write/send slack notes',
          'Turn off night mode on the phone',
          'Tidy up office area, desk',
        ],
      },
    ],
    closing: [
      {
        section: 'Building',
        items: [
          'Turn off all studio lights including lamps & LEDs',
          'Vacuum hallways and Swiffer tile/wood floors',
          'Clear away visible dust & spider webs',
          'Empty all trash cans',
          'Empty vacuum bag (Sunday night only)',
          'Empty & clean all ashtrays (Windex, no Lysol)',
          'Tidy up & restock office area, desk (including waters)',
          'Transfer blankets to ERS or PRS for wash (if used)',
          'Charge leaf blower battery',
        ],
      },
      {
        section: 'Control Rooms / Studios',
        items: [
          'Check console, racks and interior of studio for spills, burns/ash or damage. Take pictures. Vacuum ash and Windex fader covers.',
          'Wipe credenzas with Windex (no Lysol wipes, they streak)',
          "All control rooms' ACs set to 75, cool, auto, schedule OFF — live room ACs OFF",
          'Vacuum floors and Swiffer hardwood',
          'Take out trash',
          'Shut TVs and cable boxes off, clean TV surface with microfiber cloth',
          'Restock supplies: Gaff/console tape, 6 of each colored pen, 6 sharp pencils, 3 of each colored sharpie, 3 of each colored ultra fine sharpie, 3 highlighters, 1 large post-it notes, 3 large notepads, 3 small notepads, 1 pair of scissors, Febreeze, earplugs, tissues, hand sanitizer, 3 extra toilet paper rolls in bathroom',
          'Sharpen pencils, set engineer pad, pen and pencil',
          'Put candles on charger',
          'Remove previous session items, straighten pillows, furniture, square off items',
          'Organize patch cables, mic stands, gobos, put away unused/extra equipment, cut the board',
          'Live Rooms: Put all mic stands in place, broken down, organized by size and make. Organize all gobos. Break down and put back guitar stands, keyboard stands, chairs, stools, music stands.',
        ],
      },
      {
        section: 'Bathrooms',
        items: [
          'Clean counters & toilets',
          'Windex mirrors',
          'Sweep & mop floors',
          'Restock paper towels, toilet paper, Kleenex, supplies as needed',
        ],
      },
      {
        section: 'Kitchen Area',
        items: [
          'Sweep & Swiffer mop floors',
          'Load & run dishwasher',
          'Clean sink, counters, refrigerator, freezer, microwave',
          'Clean tea kettle (heat small amount of vinegar, then wash with soap) and coffee maker',
          'Create fruit bowl for the next day',
          'Stock and tidy (straws, cups, fridge water etc.)',
        ],
      },
      {
        section: 'Paperwork',
        items: [
          'Complete microphone inventory — report discrepancies. Email Inventory to Tom and to info@paramountrecording.com separately.',
          'Complete closing count for petty cash, report discrepancies',
          'Email to Paramount: Completed Session Invoices, Petty Cash Log, Stock Inventory List, Mic Inventory list, Expense Sheets w/ receipts, slack notes',
          'Upload all run receipts to Ramp and file accordingly',
        ],
      },
      {
        section: 'Before you leave',
        items: [
          'Write/send slack notes',
          'Set phone to night mode',
          "Confirm the opener's start time. CHECK WITH MANAGEMENT BEFORE 12AM IF ANY UNCERTAINTY.",
          'Studio doors and production room doors are deadbolted',
          'Camera screen and computer screen are turned off',
          'Had cleaners?',
          'The alarm is set',
          'The front door is locked as you leave the building',
          'The gate is closed and locked',
        ],
      },
    ],
  },
}

export function getChecklistSections(studio: string, category: string): ChecklistSection[] {
  const type = category === 'opening_checklist' ? 'opening' : 'closing'
  return CHECKLISTS[studio]?.[type] ?? CHECKLISTS.paramount[type]
}

export function flattenSections(sections: ChecklistSection[]): string[] {
  return sections.flatMap(s => s.items)
}
