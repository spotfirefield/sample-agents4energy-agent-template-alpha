export const defaultPrompts = [
    `Using the available LAS files, Generate a crossplot of neutron porosity versus density for well 15_9-15, highlight potential gas zones, and calculate average porosity in the reservoir interval (2500 - 3500 m). 
    What lithology dominates this section based on the gamma ray response?`,
    `Evaluate the LAS data from wells 15_9-15 and 34_8-1 to identify potential hydrocarbon-bearing zones. 
    Calculate water saturation using the Archie equation with the following parameters: a=1, m=2, n=2, Rw=0.05 ohm-m at formation temperature. 
    Generate a multi-well comparison showing gamma ray, resistivity, and calculated water saturation. 
    Which well shows better reservoir quality and why?`,
    `Develop a comprehensive petrophysical model for Well 15_9-15 using the available LAS files. 
    First, perform environmental corrections on the log data. 
    Then, determine clay volume using gamma ray index, calculate effective porosity accounting for clay effects, and estimate permeability using a suitable model. 
    Finally, identify pay zones using cutoffs of Vclay<30%, porosity>12%, and Sw<50%. 
    Present your results as a composite log display and summarize the net pay thickness and average petrophysical properties. 
    `,
]
