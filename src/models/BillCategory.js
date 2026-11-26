const CATEGORIES = [
  { code: 'electricity', name: 'Electricity Bill', icon: 'zap', description: 'Monthly electricity and power consumption charges' },
  { code: 'water', name: 'Water Bill', icon: 'droplet', description: 'Monthly water supply and maintenance charges' },
  { code: 'telecom', name: 'Telecom Bill', icon: 'wifi', description: 'Internet, Wi-Fi, and telecommunication charges' },
  { code: 'restaurant', name: 'Restaurant Bill', icon: 'utensils', description: 'Boarding house shared food and catering charges' },
  { code: 'other', name: 'Other Expenses', icon: 'receipt', description: 'Cleaning, repairs, maintenance, and miscellaneous expenses' },
];

const CATEGORY_CODES = CATEGORIES.map(c => c.code);

module.exports = {
  CATEGORIES,
  CATEGORY_CODES,
  getCategoryName: (code) => {
    const found = CATEGORIES.find(c => c.code === code);
    return found ? found.name : code;
  },
};
