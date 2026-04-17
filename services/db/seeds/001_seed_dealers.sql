-- Seed: 001_seed_dealers
-- Inserts the two known dealer groups and their Laredo, TX locations (spec §1.4)
-- Run via: npm run seed

-- Sames Auto Group
INSERT INTO dealers (name, group_name, platform, base_url, inventory_url, specials_url, zip_code, is_active)
VALUES
    ('Sames Laredo Nissan',         'Sames Auto Group', 'dealer.com',      'https://www.samesnissan.com',         'https://www.samesnissan.com/new-inventory/',              'https://www.samesnissan.com/specials/',                 '78040', TRUE),
    ('Sames Laredo Ford',           'Sames Auto Group', 'dealer.com',      'https://www.samesford.com',           'https://www.samesford.com/new-inventory/',                'https://www.samesford.com/specials/',                   '78040', TRUE),
    ('Sames Laredo Honda',          'Sames Auto Group', 'dealer.com',      'https://www.sameshonda.com',          'https://www.sameshonda.com/new-inventory/',               'https://www.sameshonda.com/specials/',                  '78040', TRUE),
    ('Sames Laredo Kia',            'Sames Auto Group', 'dealer.com',      'https://www.sameskia.com',            'https://www.sameskia.com/new-inventory/',                 'https://www.sameskia.com/specials/',                    '78040', TRUE),
    ('Sames Laredo Mazda',          'Sames Auto Group', 'dealer.com',      'https://www.samesmazda.com',          'https://www.samesmazda.com/new-inventory/',               'https://www.samesmazda.com/specials/',                  '78040', TRUE),

-- Powell Watson Auto Group
    ('Powell Watson Laredo RAM',        'Powell Watson Auto Group', 'dealer_inspire', 'https://www.powellwatsonram.com',        'https://www.powellwatsonram.com/new-inventory/',         'https://www.powellwatsonram.com/specials/',              '78041', TRUE),
    ('Powell Watson Laredo Chevrolet',  'Powell Watson Auto Group', 'dealer_inspire', 'https://www.powellwatsonchevy.com',      'https://www.powellwatsonchevy.com/new-inventory/',       'https://www.powellwatsonchevy.com/specials/',            '78041', TRUE),
    ('Powell Watson Laredo Toyota',     'Powell Watson Auto Group', 'dealer_inspire', 'https://www.powellwatsontoyota.com',     'https://www.powellwatsontoyota.com/new-inventory/',      'https://www.powellwatsontoyota.com/specials/',           '78041', TRUE),
    ('Powell Watson Laredo GMC',        'Powell Watson Auto Group', 'dealer_inspire', 'https://www.powellwatsongmc.com',        'https://www.powellwatsongmc.com/new-inventory/',         'https://www.powellwatsongmc.com/specials/',              '78041', TRUE),
    ('Powell Watson Laredo Buick',      'Powell Watson Auto Group', 'dealer_inspire', 'https://www.powellwatsonbuick.com',      'https://www.powellwatsonbuick.com/new-inventory/',       'https://www.powellwatsonbuick.com/specials/',            '78041', TRUE),
    ('Powell Watson Laredo Mercedes-Benz', 'Powell Watson Auto Group', 'sincro',      'https://www.powellwatsonmb.com',         'https://www.powellwatsonmb.com/new-inventory/',          'https://www.powellwatsonmb.com/specials/',               '78041', TRUE);
